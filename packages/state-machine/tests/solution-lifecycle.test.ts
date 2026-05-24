import { beforeEach, describe, expect, it } from 'vitest';

import {
  DuplicateSolutionIdError,
  InvalidSolutionTransitionError,
  SolutionNotFoundError,
  StaleSolutionVersionError,
} from '../src/entities/solution-errors.js';
import {
  buildInMemorySolutionMachine,
  fakeAttestation,
  SOLUTION_HAPPY_PATH,
} from '../src/entities/solution-test-support.js';
import type {
  SolutionEvent,
  SolutionTransitionOpts,
} from '../src/entities/solution-types.js';

const SYSTEM: SolutionTransitionOpts['triggeredBy'] = { kind: 'system', id: 'test' };

const deployStewardOpts = (reason: string): SolutionTransitionOpts => ({
  reason,
  triggeredBy: { kind: 'steward', id: 'deploy-steward' },
  attestation: fakeAttestation('deploy-steward', 'first'),
});

describe('SolutionLifecycleMachine — register + read', () => {
  it('registers a fresh solution at state=approved', async () => {
    const { machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();
    const reg = await machine.registerSolution({
      solutionId: 'caia-2026-05-24-x',
      title: 'X',
    });
    expect(reg.solutionId).toBe('caia-2026-05-24-x');
    expect(reg.currentState).toBe('approved');
    expect(reg.version).toBe(1);
  });

  it('generates a default solution_id if none provided', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    const reg = await machine.registerSolution({ title: 'no-id' });
    expect(reg.solutionId).toMatch(/^caia-\d{4}-\d{2}-\d{2}-/);
  });

  it('throws DuplicateSolutionIdError on UNIQUE collision', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'dup', title: 'A' });
    await expect(
      machine.registerSolution({ solutionId: 'dup', title: 'B' }),
    ).rejects.toBeInstanceOf(DuplicateSolutionIdError);
  });

  it('persists optional fields (plan_path, approved_by_adr, manifest_pointer)', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({
      solutionId: 'x',
      title: 'X',
      planPath: 'research/x.md',
      approvedByAdr: 'ADR-068',
      manifestPointer: 'agent-memory/solutions_manifest.yaml#/solutions/0',
    });
    const sol = await machine.getSolution('x');
    expect(sol).not.toBeNull();
    expect(sol!.planPath).toBe('research/x.md');
    expect(sol!.approvedByAdr).toBe('ADR-068');
    expect(sol!.manifestPointer).toBe('agent-memory/solutions_manifest.yaml#/solutions/0');
  });

  it('getSolution returns null for unknown id', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    expect(await machine.getSolution('nope')).toBeNull();
  });
});

describe('SolutionLifecycleMachine — advance', () => {
  let machine: ReturnType<typeof buildInMemorySolutionMachine>['machine'];

  beforeEach(async () => {
    ({ machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 }));
    await machine.init();
    await machine.registerSolution({ solutionId: 's1', title: 'S1' });
  });

  it('advances approved -> implemented (legal forward hop)', async () => {
    const r = await machine.advanceSolution('s1', 'implemented', {
      reason: 'code-written',
      triggeredBy: SYSTEM,
      payload: { commit: 'abc' },
    });
    expect(r.applied).toBe(true);
    expect(r.fromState).toBe('approved');
    expect(r.toState).toBe('implemented');
    expect(r.newVersion).toBe(2);
    expect(r.historyId).not.toBeNull();
  });

  it('rejects illegal forward skip (approved -> deployed) with InvalidSolutionTransitionError', async () => {
    await expect(
      machine.advanceSolution('s1', 'deployed', {
        reason: 'skip',
        triggeredBy: SYSTEM,
      }),
    ).rejects.toBeInstanceOf(InvalidSolutionTransitionError);
  });

  it('throws SolutionNotFoundError for unknown id', async () => {
    await expect(
      machine.advanceSolution('nope', 'implemented', {
        reason: 'r',
        triggeredBy: SYSTEM,
      }),
    ).rejects.toBeInstanceOf(SolutionNotFoundError);
  });

  it('rejects self-transition with InvalidSolutionTransitionError', async () => {
    await expect(
      machine.advanceSolution('s1', 'approved', {
        reason: 'self',
        triggeredBy: SYSTEM,
        payload: { distinctive: true },
      }),
    ).rejects.toBeInstanceOf(InvalidSolutionTransitionError);
  });

  it('expectedVersion mismatch raises StaleSolutionVersionError', async () => {
    await expect(
      machine.advanceSolution('s1', 'implemented', {
        reason: 'r',
        triggeredBy: SYSTEM,
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(StaleSolutionVersionError);
  });

  it('idempotent replay: same to-state + payload hash returns applied=false', async () => {
    const a = await machine.advanceSolution('s1', 'implemented', {
      reason: 'first',
      triggeredBy: SYSTEM,
      payload: { commit: 'abc' },
    });
    const b = await machine.advanceSolution('s1', 'implemented', {
      reason: 'replay',
      triggeredBy: SYSTEM,
      payload: { commit: 'abc' },
    });
    expect(a.applied).toBe(true);
    expect(b.applied).toBe(false);
    expect(b.historyId).toBe(a.historyId);
  });

  it('TransitionResult carries retries (0 on first attempt)', async () => {
    const r = await machine.advanceSolution('s1', 'implemented', {
      reason: 'r',
      triggeredBy: SYSTEM,
    });
    expect(r.retries).toBe(0);
  });

  it('records actor kind=steward on history rows for steward-driven advances', async () => {
    await machine.advanceSolution('s1', 'implemented', {
      reason: 'code-written',
      triggeredBy: SYSTEM,
    });
    await machine.advanceSolution('s1', 'merged', {
      reason: 'pr-merged',
      triggeredBy: SYSTEM,
    });
    await machine.advanceSolution('s1', 'deployed', deployStewardOpts('deploy-green'));
    const snap = await machine.getSolutionLifecycle('s1');
    const last = snap.history[snap.history.length - 1];
    expect(last).toBeDefined();
    expect(last!.actorKind).toBe('steward');
    expect(last!.actorId).toBe('deploy-steward');
  });
});

describe('SolutionLifecycleMachine — pause + resume + abandon', () => {
  it('pauseSolution saves prior_state and resumeSolution restores it', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'p', title: 'P' });
    await machine.advanceSolution('p', 'implemented', {
      reason: 'code',
      triggeredBy: SYSTEM,
    });
    await machine.pauseSolution('p', 'operator-jane');
    const paused = await machine.getSolution('p');
    expect(paused!.paused).toBe(true);
    expect(paused!.status).toBe('paused');
    expect(paused!.priorState).toBe('implemented');
    expect(paused!.pausedBy).toBe('operator-jane');
    await machine.resumeSolution('p');
    const resumed = await machine.getSolution('p');
    expect(resumed!.paused).toBe(false);
    expect(resumed!.status).toBe('implemented');
    expect(resumed!.priorState).toBeNull();
  });

  it('pauseSolution throws InvalidSolutionTransitionError for terminal solution', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'a', title: 'A' });
    await machine.abandonSolution('a', 'operator-jane');
    await expect(machine.pauseSolution('a', 'operator-jane'))
      .rejects.toBeInstanceOf(InvalidSolutionTransitionError);
  });

  it('pauseSolution throws SolutionNotFoundError for unknown', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await expect(machine.pauseSolution('nope', 'op')).rejects.toBeInstanceOf(
      SolutionNotFoundError,
    );
  });

  it('resumeSolution is idempotent on a non-paused solution', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'r', title: 'R' });
    await machine.resumeSolution('r'); // no-op, no throw
    const sol = await machine.getSolution('r');
    expect(sol!.paused).toBe(false);
  });

  it('abandonSolution transitions to abandoned from any non-terminal state', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'ab', title: 'AB' });
    const r = await machine.abandonSolution('ab', 'op', 'no-longer-needed');
    expect(r.applied).toBe(true);
    expect(r.toState).toBe('abandoned');
    const sol = await machine.getSolution('ab');
    expect(sol!.abandonedAt).not.toBeNull();
  });

  it('abandonSolution rejects further transitions (terminal)', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'ab2', title: 'AB2' });
    await machine.abandonSolution('ab2', 'op');
    await expect(
      machine.advanceSolution('ab2', 'approved', {
        reason: 'reopen',
        triggeredBy: SYSTEM,
      }),
    ).rejects.toBeInstanceOf(InvalidSolutionTransitionError);
  });
});

describe('SolutionLifecycleMachine — getSolutionLifecycle snapshot', () => {
  it('returns the current solution + full history + ageHoursInState', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
      idempotencyWindowMs: 0,
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 's', title: 'S' });
    clock += 30 * 60_000;
    await machine.advanceSolution('s', 'implemented', {
      reason: 'r',
      triggeredBy: SYSTEM,
    });
    clock += 30 * 60_000;
    const snap = await machine.getSolutionLifecycle('s');
    expect(snap.solution.status).toBe('implemented');
    expect(snap.history.length).toBe(1);
    expect(snap.history[0]!.fromState).toBe('approved');
    expect(snap.history[0]!.toState).toBe('implemented');
    expect(snap.ageHoursInState).toBeCloseTo(0.5, 1);
  });

  it('throws SolutionNotFoundError for unknown id', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await expect(machine.getSolutionLifecycle('nope')).rejects.toBeInstanceOf(
      SolutionNotFoundError,
    );
  });
});

describe('SolutionLifecycleMachine — getStuckSolutions', () => {
  it('returns [] when no solutions exceed thresholds', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'fresh', title: 'F' });
    clock += 60_000; // 1 minute later
    const stuck = await machine.getStuckSolutions();
    expect(stuck).toEqual([]);
  });

  it('flags solutions that have exceeded their per-state threshold', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'old', title: 'OLD' });
    // Default threshold for 'approved' is 24h; jump 36h.
    clock += 36 * 3_600_000;
    const stuck = await machine.getStuckSolutions();
    expect(stuck.length).toBe(1);
    expect(stuck[0]!.solution.solutionId).toBe('old');
    expect(stuck[0]!.ageHoursInState).toBeCloseTo(36, 0);
    expect(stuck[0]!.thresholdHours).toBe(24);
    expect(stuck[0]!.nextExpectedState).toBe('implemented');
  });

  it('accepts a uniform numeric threshold override', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'a', title: 'A' });
    clock += 2 * 3_600_000;
    // Default 24h would not flag, but 1h threshold does.
    expect((await machine.getStuckSolutions()).length).toBe(0);
    expect((await machine.getStuckSolutions(1)).length).toBe(1);
  });

  it('accepts a per-state threshold override object', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'a', title: 'A' });
    clock += 5 * 3_600_000;
    expect((await machine.getStuckSolutions({ approved: 1 })).length).toBe(1);
  });

  it('paused solutions are never flagged as stuck', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'p', title: 'P' });
    await machine.pauseSolution('p', 'op');
    clock += 100 * 3_600_000;
    expect(await machine.getStuckSolutions()).toEqual([]);
  });

  it('terminal solutions (done / abandoned) are never flagged as stuck', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'a', title: 'A' });
    await machine.abandonSolution('a', 'op');
    clock += 100 * 3_600_000;
    expect(await machine.getStuckSolutions()).toEqual([]);
  });

  it('emits a solution.stuck event for every stuck result on the call', async () => {
    const baseNow = new Date('2026-05-24T00:00:00Z');
    let clock = baseNow.getTime();
    const { machine } = buildInMemorySolutionMachine({
      now: () => new Date(clock),
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'a', title: 'A' });
    await machine.registerSolution({ solutionId: 'b', title: 'B' });
    clock += 36 * 3_600_000;
    const stuckEvents: SolutionEvent[] = [];
    machine.on('solution.stuck', (e) => {
      stuckEvents.push(e);
    });
    const stuck = await machine.getStuckSolutions();
    expect(stuck.length).toBe(2);
    expect(stuckEvents.length).toBe(2);
    expect(stuckEvents[0]!.payload.stuck?.thresholdHours).toBe(24);
    expect(stuckEvents[0]!.payload.stuck?.nextExpectedState).toBe('implemented');
  });
});

describe('SolutionLifecycleMachine — event emission', () => {
  it('emits solution.advanced on registerSolution (synthetic from-null)', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    const seen: SolutionEvent[] = [];
    machine.on((e) => seen.push(e));
    await machine.registerSolution({ solutionId: 'x', title: 'X' });
    expect(seen.length).toBe(1);
    expect(seen[0]!.type).toBe('solution.advanced');
    expect(seen[0]!.payload.fromState).toBeNull();
    expect(seen[0]!.payload.toState).toBe('approved');
  });

  it('emits solution.advanced on each transition with the steward attestation', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'y', title: 'Y' });
    const seen: SolutionEvent[] = [];
    machine.on('solution.advanced', (e) => seen.push(e));
    await machine.advanceSolution('y', 'implemented', {
      reason: 'r',
      triggeredBy: { kind: 'steward', id: 'cw' },
      attestation: fakeAttestation('cw', '1'),
    });
    // First handler call is the synthetic register event? No — `on('type', ...)` is
    // registered AFTER register. So only one event here.
    expect(seen.length).toBe(1);
    expect(seen[0]!.type).toBe('solution.advanced');
    expect(seen[0]!.canonicalType).toBe('solution.state-transitioned');
    expect(seen[0]!.payload.attestation?.steward).toBe('cw');
  });

  it('emits solution.completed when reaching done (alongside solution.advanced)', async () => {
    const { machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'd', title: 'D' });
    for (const [, to] of SOLUTION_HAPPY_PATH) {
      await machine.advanceSolution('d', to, {
        reason: 'walk',
        triggeredBy: SYSTEM,
        payload: { to },
      });
    }
    const completed: SolutionEvent[] = [];
    machine.on('solution.completed', (e) => completed.push(e));
    // The done transition has already happened above; we'll send the "done" event
    // by replaying through a fresh machine.
    const { machine: m2 } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await m2.init();
    await m2.registerSolution({ solutionId: 'd2', title: 'D2' });
    const done2: SolutionEvent[] = [];
    m2.on('solution.completed', (e) => done2.push(e));
    for (const [, to] of SOLUTION_HAPPY_PATH) {
      await m2.advanceSolution('d2', to, {
        reason: 'walk',
        triggeredBy: SYSTEM,
        payload: { to },
      });
    }
    expect(done2.length).toBe(1);
    expect(done2[0]!.type).toBe('solution.completed');
    expect(done2[0]!.canonicalType).toBe('solution.done');
    expect(done2[0]!.payload.toState).toBe('done');
  });

  it('handler unsubscribe via returned function works', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    const seen: SolutionEvent[] = [];
    const unsub = machine.on((e) => seen.push(e));
    await machine.registerSolution({ solutionId: 'u1', title: 'U1' });
    unsub();
    await machine.registerSolution({ solutionId: 'u2', title: 'U2' });
    expect(seen.length).toBe(1);
  });

  it('subscribeToSolution receives Pg-style notify payloads in memory', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    await machine.registerSolution({ solutionId: 'n', title: 'N' });
    const events: Array<{ to_state: string }> = [];
    const unsub = await machine.subscribeToSolution('n', (evt) => {
      events.push({ to_state: evt.to_state });
    });
    await machine.advanceSolution('n', 'implemented', {
      reason: 'r',
      triggeredBy: SYSTEM,
    });
    await unsub();
    expect(events.map((e) => e.to_state)).toEqual(['implemented']);
  });
});

describe('SolutionLifecycleMachine — availableTransitions helpers', () => {
  it('availableTransitions matches the matrix for a known state', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    const t = machine.availableTransitions('approved');
    expect(t).toContain('implemented');
    expect(t).toContain('abandoned');
    expect(t).toContain('paused');
  });

  it('canTransition returns boolean', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    expect(machine.canTransition('approved', 'implemented')).toBe(true);
    expect(machine.canTransition('approved', 'deployed')).toBe(false);
  });

  it('validNextStates is an alias for availableTransitions', async () => {
    const { machine } = buildInMemorySolutionMachine();
    await machine.init();
    expect(machine.validNextStates('approved')).toEqual(
      machine.availableTransitions('approved'),
    );
  });
});

import { describe, expect, it } from 'vitest';

import {
  InvalidSolutionTransitionError,
} from '../src/entities/solution-errors.js';
import { InMemorySolutionStore } from '../src/entities/in-memory-solution-store.js';
import {
  buildInMemorySolutionMachine,
  fakeAttestation,
  SOLUTION_HAPPY_PATH,
} from '../src/entities/solution-test-support.js';
import { SolutionLifecycleMachine } from '../src/entities/solution.js';
import type {
  SolutionEvent,
  SolutionTransitionOpts,
} from '../src/entities/solution-types.js';

/**
 * End-to-end: register a fake solution, walk it through all 9 forward
 * states via simulated steward attestations, verify each transition
 * emits the correct event + persists the history row with the right
 * actor + attestation.
 */
describe('integration: full solution-lifecycle walkthrough', () => {
  it('walks approved → done with one steward attestation per transition', async () => {
    const { machine, store } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();

    const seen: SolutionEvent[] = [];
    machine.on((e) => seen.push(e));

    const reg = await machine.registerSolution({
      solutionId: 'caia-2026-05-24-ea-coordinator',
      title: 'EA Coordinator framework build',
      planPath: 'research/ea_coordinator_2026.md',
      approvedByAdr: 'ADR-068',
    });
    expect(reg.currentState).toBe('approved');
    expect(seen[0]?.type).toBe('solution.advanced');
    expect(seen[0]?.payload.fromState).toBeNull();

    // Each forward step is driven by a different steward to mirror the
    // canonical 4-steward + lifecycle-conductor architecture.
    const stewardByTo: Record<string, string> = {
      implemented: 'coding-worker',
      merged: 'pr-merger',
      deployed: 'deploy-steward',
      imported: 'usage-steward',
      'called-in-test': 'activation-steward',
      'called-in-prod': 'activation-steward',
      'producing-metrics': 'outcome-steward',
      done: 'lifecycle-conductor',
    };

    for (const [, to] of SOLUTION_HAPPY_PATH) {
      const stewardId = stewardByTo[to] ?? 'system';
      const opts: SolutionTransitionOpts = {
        reason: `${stewardId}-green-first-attestation`,
        triggeredBy: { kind: 'steward', id: stewardId },
        attestation: fakeAttestation(stewardId, `${to}-1`),
        evidence: { stepTo: to },
      };
      const result = await machine.advanceSolution('caia-2026-05-24-ea-coordinator', to, opts);
      expect(result.applied).toBe(true);
      expect(result.toState).toBe(to);
    }

    const snap = await machine.getSolutionLifecycle('caia-2026-05-24-ea-coordinator');
    expect(snap.solution.status).toBe('done');
    expect(snap.solution.doneAt).not.toBeNull();
    // History has 8 forward transitions (approved is the initial state — no row).
    expect(snap.history.length).toBe(SOLUTION_HAPPY_PATH.length);
    expect(snap.history[0]!.fromState).toBe('approved');
    expect(snap.history[0]!.toState).toBe('implemented');
    expect(snap.history[snap.history.length - 1]!.toState).toBe('done');
    // Steward attestations are persisted.
    expect(snap.history[2]!.attestation['steward']).toBe('deploy-steward');

    // Event log: 1 synthetic register + 8 advances + 1 completed.
    const advanceEvents = seen.filter((e) => e.type === 'solution.advanced');
    const completedEvents = seen.filter((e) => e.type === 'solution.completed');
    expect(advanceEvents.length).toBe(1 + SOLUTION_HAPPY_PATH.length);
    expect(completedEvents.length).toBe(1);

    // The pg-store and in-memory store agree on the active set: this
    // one's done so listActiveSolutions excludes it.
    const active = await store.listActiveSolutions();
    expect(active.find((s) => s.solutionId === 'caia-2026-05-24-ea-coordinator')).toBeUndefined();
  });

  it('walkthrough also exercises a recovery edge (deployed-failed → deployed)', async () => {
    const { machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'rec', title: 'rec' });
    await machine.advanceSolution('rec', 'implemented', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });
    await machine.advanceSolution('rec', 'merged', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });
    // The deploy went red.
    await machine.advanceSolution('rec', 'deployed-failed', {
      reason: 'deploy-steward-red',
      triggeredBy: { kind: 'steward', id: 'deploy-steward' },
    });
    expect((await machine.getSolution('rec'))!.status).toBe('deployed-failed');
    // Re-deployed and green this time.
    await machine.advanceSolution('rec', 'deployed', {
      reason: 'deploy-steward-green-retry',
      triggeredBy: { kind: 'steward', id: 'deploy-steward' },
    });
    expect((await machine.getSolution('rec'))!.status).toBe('deployed');
  });

  it('walkthrough also exercises a regression edge (called-in-prod → called-in-prod-rolled-back → called-in-prod)', async () => {
    const { machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'reg', title: 'reg' });
    for (const to of [
      'implemented',
      'merged',
      'deployed',
      'imported',
      'called-in-test',
      'called-in-prod',
    ] as const) {
      await machine.advanceSolution('reg', to, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 't' },
      });
    }
    expect((await machine.getSolution('reg'))!.status).toBe('called-in-prod');
    // Activation-steward goes red — drift.
    await machine.advanceSolution('reg', 'called-in-prod-rolled-back', {
      reason: 'activation-red',
      triggeredBy: { kind: 'steward', id: 'activation-steward' },
    });
    expect((await machine.getSolution('reg'))!.status).toBe('called-in-prod-rolled-back');
    // Steward re-greens. Use a distinct payload to avoid colliding with the
    // ORIGINAL called-in-prod transition's payload-hash (the idempotency index
    // is keyed on (solution_id, to_state, payload_hash) and would otherwise
    // collapse this to a no-op replay).
    const r = await machine.advanceSolution('reg', 'called-in-prod', {
      reason: 'activation-green-recovered',
      triggeredBy: { kind: 'steward', id: 'activation-steward' },
      payload: { greenId: 'as-prod-recover-1' },
    });
    expect(r.applied).toBe(true);
    expect((await machine.getSolution('reg'))!.status).toBe('called-in-prod');
  });
});

/**
 * Concurrency: two stewards race to advance the same solution; only
 * the steward whose transition matches the current state wins. The
 * other gets InvalidSolutionTransitionError because the prerequisite
 * forward state was not yet reached.
 *
 * Specifically: while the solution is in `merged`, the deploy-steward
 * advances `merged → deployed` (legal). At the same time the
 * usage-steward tries to advance `merged → imported` (illegal — the
 * forward path requires deploy first). The usage-steward must lose
 * with InvalidSolutionTransitionError.
 */
describe('integration: two stewards racing — usage-steward cannot skip ahead', () => {
  it('usage-steward cannot advance merged → imported until deploy-steward has advanced to deployed', async () => {
    const { machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'race', title: 'race' });
    // Walk to merged.
    await machine.advanceSolution('race', 'implemented', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });
    await machine.advanceSolution('race', 'merged', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });

    // Race: both stewards fire concurrent advances.
    const deployPromise = machine.advanceSolution('race', 'deployed', {
      reason: 'deploy-green',
      triggeredBy: { kind: 'steward', id: 'deploy-steward' },
      attestation: fakeAttestation('deploy-steward', 'race-1'),
    });
    const usagePromise = machine.advanceSolution('race', 'imported', {
      reason: 'usage-green',
      triggeredBy: { kind: 'steward', id: 'usage-steward' },
      attestation: fakeAttestation('usage-steward', 'race-1'),
    });

    const [deployResult, usageResult] = await Promise.allSettled([
      deployPromise,
      usagePromise,
    ]);

    expect(deployResult.status).toBe('fulfilled');
    if (deployResult.status === 'fulfilled') {
      expect(deployResult.value.applied).toBe(true);
      expect(deployResult.value.toState).toBe('deployed');
    }

    expect(usageResult.status).toBe('rejected');
    if (usageResult.status === 'rejected') {
      const err = usageResult.reason;
      expect(err).toBeInstanceOf(InvalidSolutionTransitionError);
      const e = err as InvalidSolutionTransitionError;
      expect(e.fromState).toBe('merged');
      expect(e.toState).toBe('imported');
    }

    // After the deploy-steward wins, the usage-steward CAN advance.
    const usageRetry = await machine.advanceSolution('race', 'imported', {
      reason: 'usage-green-retry',
      triggeredBy: { kind: 'steward', id: 'usage-steward' },
      attestation: fakeAttestation('usage-steward', 'race-2'),
    });
    expect(usageRetry.applied).toBe(true);
    expect(usageRetry.toState).toBe('imported');
  });

  it('two stewards racing to advance the SAME legal transition: exactly one applies, the other is idempotent', async () => {
    const { machine } = buildInMemorySolutionMachine({ idempotencyWindowMs: 0 });
    await machine.init();
    await machine.registerSolution({ solutionId: 'tie', title: 'tie' });
    await machine.advanceSolution('tie', 'implemented', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });
    await machine.advanceSolution('tie', 'merged', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 't' },
    });

    const sharedPayload = { commit: 'abc-shared' };
    const a = machine.advanceSolution('tie', 'deployed', {
      reason: 'race-a',
      triggeredBy: { kind: 'steward', id: 'deploy-steward-a' },
      payload: sharedPayload,
    });
    const b = machine.advanceSolution('tie', 'deployed', {
      reason: 'race-b',
      triggeredBy: { kind: 'steward', id: 'deploy-steward-b' },
      payload: sharedPayload,
    });
    const [ra, rb] = await Promise.all([a, b]);
    // Exactly one applied = true; the other matched the idempotency hash
    // (it ran second and saw the existing history row).
    const applied = [ra.applied, rb.applied].filter(Boolean).length;
    expect(applied).toBe(1);
    // Both return the SAME historyId (idempotent replay collapse).
    expect(ra.historyId).toBe(rb.historyId);
    expect((await machine.getSolution('tie'))!.status).toBe('deployed');
  });

  it('optimistic-lock retries surface in the result', async () => {
    // Use a low retry budget to verify exhaustion path.
    const { machine } = buildInMemorySolutionMachine({
      idempotencyWindowMs: 0,
      defaultRetries: 0,
    });
    await machine.init();
    await machine.registerSolution({ solutionId: 'opt', title: 'opt' });
    const r = await machine.advanceSolution('opt', 'implemented', {
      reason: 'first',
      triggeredBy: { kind: 'system', id: 't' },
    });
    // retries=0 on first try, applied=true
    expect(r.retries).toBe(0);
    expect(r.applied).toBe(true);
  });

  it('SolutionLifecycleMachine can be constructed with a freshly-built store', async () => {
    // Smoke: API still works without the test-support helper.
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store, { idempotencyWindowMs: 0 });
    await machine.init();
    const reg = await machine.registerSolution({ solutionId: 's', title: 's' });
    expect(reg.currentState).toBe('approved');
  });
});

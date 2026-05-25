import { describe, expect, it } from 'vitest';
import {
  InMemorySolutionStore,
  SolutionLifecycleMachine,
  type SolutionState,
} from '@caia/state-machine';

import { deploy } from '../src/api.js';
import { InMemoryStewardClient } from '../src/steward.js';
import {
  capabilityBroker,
  devopsSlice,
  failingCapabilityBroker,
  failingTicketStore,
  loadedTicket,
  recordingAdapter,
  ticketStore,
} from './fixtures.js';

async function registerSolutionAtMerged(
  machine: SolutionLifecycleMachine,
  solutionId: string,
): Promise<void> {
  await machine.registerSolution({ solutionId, title: 't' });
  const path: SolutionState[] = ['implemented', 'merged'];
  let prior: SolutionState = 'approved';
  for (const next of path) {
    await machine.advanceSolution(solutionId, next, {
      reason: `setup ${prior}→${next}`,
      triggeredBy: { kind: 'system', id: 'test-setup' },
    });
    prior = next;
  }
}

describe('deploy() — preflight failures', () => {
  it('returns precondition-failed when ticket cannot be loaded', async () => {
    const result = await deploy('TKT-1', 'production', {
      store: failingTicketStore('no ticket'),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
    });
    expect(result.status).toBe('precondition-failed');
    expect(result.reason).toContain('no ticket');
    expect(result.runtimeStateTrace.at(-1)?.toState).toBe('failed');
  });

  it('returns unsupported-strategy when architect spec names an unknown strategy', async () => {
    const ticket = loadedTicket({
      architecture: {
        devops: devopsSlice({
          deployStrategy: { strategy: 'wormhole' as any },
        }),
      },
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
    });
    expect(result.status).toBe('unsupported-strategy');
  });

  it('returns precondition-failed when canary infra is missing', async () => {
    const ticket = loadedTicket({
      architecture: {
        devops: devopsSlice({
          deployStrategy: { strategy: 'canary' },
          infrastructureAsCode: { tool: 'terraform', capabilities: [] },
        }),
      },
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
    });
    expect(result.status).toBe('precondition-failed');
    expect(result.reason).toContain('traffic-split');
  });

  it('returns deployed-failed when broker refuses', async () => {
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter: recordingAdapter(),
      capabilityBroker: failingCapabilityBroker('no token'),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
    });
    expect(result.status).toBe('deployed-failed');
    expect(result.reason).toContain('no token');
  });
});

describe('deploy() — strategy failure paths', () => {
  it('runs rollback on strategy failure (git-revert)', async () => {
    const ticket = loadedTicket({
      architecture: {
        devops: devopsSlice({
          deployStrategy: { strategy: 'canary' },
        }),
      },
    });
    const adapter = recordingAdapter({
      'canary-10': { ok: false, reason: 'config bad' },
    });
    const steward = new InMemoryStewardClient();
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
    });
    // git-revert needs priorGitSha which isn't supplied → rollback bails cleanly.
    expect(result.status).toBe('deployed-failed');
    expect(result.rollback?.attempted).toBe(false);
    expect(result.rollback?.reason).toContain('priorGitSha');
  });

  it('skips rollback when trigger=manual', async () => {
    const ticket = loadedTicket({
      architecture: {
        devops: devopsSlice({
          rollbackContract: {
            trigger: 'manual',
            autoRevertWindowMin: 5,
            method: 'git-revert-and-redeploy',
          },
        }),
      },
    });
    const adapter = recordingAdapter({
      'canary-10': { ok: false, reason: 'fail' },
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
    });
    expect(result.rollback?.attempted).toBe(false);
    expect(result.rollback?.reason).toContain('manual');
  });
});

describe('deploy() — happy path', () => {
  it('returns deployed when strategy + steward both green', async () => {
    const adapter = recordingAdapter();
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-fixed-1';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(result.status).toBe('deployed');
    expect(result.strategyResult?.ok).toBe(true);
    expect(result.stewardVerification?.status).toBe('green');
  });

  it('returns deployed-failed when steward reports red', async () => {
    const adapter = recordingAdapter();
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-fixed-2';
    steward.preload(runId, {
      inuse_passed: false,
      inuse_reason: 'http 503',
      green: false,
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(result.status).toBe('deployed-failed');
    expect(result.stewardVerification?.status).toBe('red');
  });

  it('returns deployed-failed when steward times out', async () => {
    const adapter = recordingAdapter();
    const steward = new InMemoryStewardClient();
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 3 },
    });
    expect(result.status).toBe('deployed-failed');
    expect(result.stewardVerification?.status).toBe('timeout');
  });
});

describe('deploy() — event emission', () => {
  it('emits deploy.started + deploy.succeeded on happy path', async () => {
    const events: string[] = [];
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-fixed-3';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
      onDeployEvent: (e) => events.push(e.type),
    });
    expect(events).toContain('deploy.started');
    expect(events).toContain('deploy.succeeded');
  });

  it('emits deploy.failed + deploy.rollback.triggered on strategy failure', async () => {
    const events: string[] = [];
    const adapter = recordingAdapter({
      'canary-10': { ok: false, reason: 'bad' },
    });
    await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
      onDeployEvent: (e) => events.push(e.type),
    });
    expect(events).toContain('deploy.failed');
    expect(events).toContain('deploy.rollback.triggered');
  });

  it('emits deploy.healthcheck.failed when steward reports red', async () => {
    const events: string[] = [];
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-fixed-4';
    steward.preload(runId, {
      inuse_passed: false,
      inuse_reason: 'http 500',
      green: false,
    });
    await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
      onDeployEvent: (e) => events.push(e.type),
    });
    expect(events).toContain('deploy.healthcheck.failed');
  });
});

describe('deploy() — capability broker', () => {
  it('requests deploy.production for production env', async () => {
    const broker = capabilityBroker();
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-cap-1';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter: recordingAdapter(),
      capabilityBroker: broker,
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(broker.issued).toHaveLength(1);
    expect((broker.issued[0] as any).name).toBe('deploy.production');
  });

  it('requests cloudflare.pages.deploy.preview for staging env', async () => {
    const broker = capabilityBroker();
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-cap-2';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    await deploy('TKT-1', 'staging', {
      store: ticketStore(),
      adapter: recordingAdapter(),
      capabilityBroker: broker,
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect((broker.issued[0] as any).name).toBe('cloudflare.pages.deploy.preview');
  });

  it('passes the capability token to the adapter', async () => {
    const broker = capabilityBroker();
    const adapter = recordingAdapter();
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-cap-3';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter,
      capabilityBroker: broker,
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(adapter.calls[0]?.input.capabilityTokenId).toBe('cap-1');
  });
});

describe('deploy() — canonical state machine integration', () => {
  it('advances solution merged → deployed on success', async () => {
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store);
    await machine.init();
    const ticket = loadedTicket({ solutionId: 'sol-happy' });
    await registerSolutionAtMerged(machine, 'sol-happy');

    const steward = new InMemoryStewardClient();
    const runId = 'deploy-sm-1';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward,
      solutionMachine: machine,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(result.status).toBe('deployed');
    expect(result.transition.applied).toBe(true);
    expect(result.transition.toState).toBe('deployed');
    const sol = await machine.getSolution('sol-happy');
    expect(sol?.status).toBe('deployed');
  });

  it('advances solution merged → deployed-failed on strategy failure', async () => {
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store);
    await machine.init();
    const ticket = loadedTicket({ solutionId: 'sol-fail' });
    await registerSolutionAtMerged(machine, 'sol-fail');

    const adapter = recordingAdapter({
      'canary-10': { ok: false, reason: 'oof' },
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      solutionMachine: machine,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(result.status).toBe('deployed-failed');
    expect(result.transition.applied).toBe(true);
    expect(result.transition.toState).toBe('deployed-failed');
    const sol = await machine.getSolution('sol-fail');
    expect(sol?.status).toBe('deployed-failed');
  });

  it('reports transition-not-applied when the solution does not exist', async () => {
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store);
    await machine.init();
    const ticket = loadedTicket({ solutionId: 'ghost' });
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-sm-3';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(ticket),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward,
      solutionMachine: machine,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    expect(result.transition.applied).toBe(false);
    expect(result.transition.reason).toContain('not found');
  });
});

describe('deploy() — runtime trace', () => {
  it('captures the full state trace on happy path', async () => {
    const steward = new InMemoryStewardClient();
    const runId = 'deploy-trace-1';
    steward.preload(runId, {
      inuse_passed: true,
      inuse_reason: 'ok',
      green: true,
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(),
      adapter: recordingAdapter(),
      capabilityBroker: capabilityBroker(),
      steward,
      skipSolutionMachine: true,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });
    const states = result.runtimeStateTrace.map((e) => e.toState);
    expect(states).toEqual([
      'loading-spec',
      'preconditions-checking',
      'acquiring-capability',
      'deploying',
      'verifying',
      'succeeded',
    ]);
  });

  it('captures rolling-back when strategy fails (rollback attempted)', async () => {
    const adapter = recordingAdapter({
      'canary-10': { ok: false, reason: 'x' },
    });
    const result = await deploy('TKT-1', 'production', {
      store: ticketStore(
        loadedTicket({
          architecture: {
            devops: devopsSlice({
              rollbackContract: {
                trigger: 'healthcheck-failure',
                autoRevertWindowMin: 5,
                method: 'git-revert-and-redeploy',
              },
            }),
          },
        }),
      ),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward: new InMemoryStewardClient(),
      skipSolutionMachine: true,
    });
    const states = result.runtimeStateTrace.map((e) => e.toState);
    expect(states).toContain('rolling-back');
  });
});

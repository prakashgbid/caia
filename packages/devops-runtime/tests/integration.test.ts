/**
 * Integration test against a stubbed K3s adapter wired through the
 * `stolution-remote` MCP shape.
 *
 * The real K3s cluster lives on the stolution box; this test wires a
 * `K3sStubAdapter` that mimics the same applyPhase / rollbackPhase
 * surface but executes against an in-process fake. The contract is what
 * matters — a production adapter delegates these calls to
 * `stolution_bash` calls that run `helm upgrade --install` /
 * `kubectl rollout undo`, etc.
 *
 * This test exercises the full deploy() → strategy → steward → state-
 * machine → rollback pipeline end-to-end with no in-test mocking past
 * the adapter boundary.
 */

import { describe, expect, it } from 'vitest';
import {
  InMemorySolutionStore,
  SolutionLifecycleMachine,
  type SolutionState,
} from '@caia/state-machine';

import { deploy } from '../src/api.js';
import { InMemoryStewardClient } from '../src/steward.js';
import type {
  ByocAdapter,
  DeployAdapterInput,
  DeployAdapterOutput,
} from '../src/types.js';
import {
  capabilityBroker,
  devopsSlice,
  loadedTicket,
  ticketStore,
} from './fixtures.js';

/** Simulates a K3s adapter. Keeps an in-memory state of "current
 * release"; helm-upgrade is applyPhase, kubectl-rollout-undo is
 * rollbackPhase. */
class K3sStubAdapter implements ByocAdapter {
  public currentSha = 'good-sha-prior';
  public events: Array<{ kind: string; sha: string; phase: string }> = [];
  public failOn: Set<string> = new Set();

  async applyPhase(input: DeployAdapterInput): Promise<DeployAdapterOutput> {
    this.events.push({ kind: 'helm-upgrade', sha: input.gitSha, phase: input.phase });
    if (this.failOn.has(input.phase)) {
      return {
        ok: false,
        phase: input.phase,
        durationMs: 5,
        reason: `k3s helm-upgrade failed at ${input.phase}`,
        healthcheck: { ok: false, status: 503 },
      };
    }
    this.currentSha = input.gitSha;
    return {
      ok: true,
      phase: input.phase,
      durationMs: 7,
      healthcheck: { ok: true, status: 200, latencyMs: 8 },
    };
  }

  async rollbackPhase(input: DeployAdapterInput): Promise<DeployAdapterOutput> {
    this.events.push({ kind: 'helm-rollback', sha: input.gitSha, phase: input.phase });
    this.currentSha = input.gitSha;
    return {
      ok: true,
      phase: input.phase,
      durationMs: 6,
      healthcheck: { ok: true, status: 200 },
    };
  }

  async restoreSnapshot(): Promise<DeployAdapterOutput> {
    return { ok: true, phase: 'snapshot-restore', durationMs: 9 };
  }
}

async function setupSolutionAtMerged(
  machine: SolutionLifecycleMachine,
  solutionId: string,
): Promise<void> {
  await machine.registerSolution({ solutionId, title: 'integration' });
  const path: SolutionState[] = ['implemented', 'merged'];
  for (const next of path) {
    await machine.advanceSolution(solutionId, next, {
      reason: `setup → ${next}`,
      triggeredBy: { kind: 'system', id: 'integration-setup' },
    });
  }
}

describe('integration: K3s stub adapter, end-to-end happy path', () => {
  it('runs canary 10/50/100 against K3s and lands solution at deployed', async () => {
    const adapter = new K3sStubAdapter();
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store);
    await machine.init();
    await setupSolutionAtMerged(machine, 'integration-sol-happy');

    const steward = new InMemoryStewardClient();
    const runId = 'integ-1';
    steward.preload(runId, { inuse_passed: true, inuse_reason: 'ok', green: true });

    const result = await deploy('TKT-INTEG-1', 'production', {
      store: ticketStore(
        loadedTicket({
          ticketId: 'TKT-INTEG-1',
          solutionId: 'integration-sol-happy',
          gitSha: 'new-sha-001',
          architecture: { devops: devopsSlice() },
        }),
      ),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward,
      solutionMachine: machine,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 100 },
    });

    expect(result.status).toBe('deployed');
    expect(adapter.events.map((e) => e.phase)).toEqual([
      'canary-10',
      'canary-50',
      'canary-100',
    ]);
    expect(adapter.currentSha).toBe('new-sha-001');
    const sol = await machine.getSolution('integration-sol-happy');
    expect(sol?.status).toBe('deployed');
    expect(steward.recorded).toHaveLength(1);
    expect(steward.recorded[0]?.deploy_passed).toBe(true);
  });
});

describe('integration: K3s stub adapter, canary aborts and rolls back', () => {
  it('aborts at 50%, runs git-revert-and-redeploy, lands solution at deployed-failed', async () => {
    const adapter = new K3sStubAdapter();
    adapter.failOn.add('canary-50');

    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store);
    await machine.init();
    await setupSolutionAtMerged(machine, 'integration-sol-rb');

    const result = await deploy('TKT-INTEG-2', 'production', {
      store: ticketStore(
        loadedTicket({
          ticketId: 'TKT-INTEG-2',
          solutionId: 'integration-sol-rb',
          gitSha: 'new-sha-bad',
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
      solutionMachine: machine,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });

    expect(result.status).toBe('deployed-failed');
    // Strategy attempted 10 + 50; rollback NOT attempted (no priorGitSha supplied).
    const phases = adapter.events.map((e) => e.phase);
    expect(phases).toContain('canary-10');
    expect(phases).toContain('canary-50');
    expect(result.rollback?.attempted).toBe(false);
    const sol = await machine.getSolution('integration-sol-rb');
    expect(sol?.status).toBe('deployed-failed');
  });
});

describe('integration: blue-green against K3s stub', () => {
  it('completes green-up + cutover and lands deployed', async () => {
    const adapter = new K3sStubAdapter();
    const store = new InMemorySolutionStore();
    const machine = new SolutionLifecycleMachine(store);
    await machine.init();
    await setupSolutionAtMerged(machine, 'integration-sol-bg');

    const steward = new InMemoryStewardClient();
    const runId = 'integ-bg-1';
    steward.preload(runId, { inuse_passed: true, inuse_reason: 'ok', green: true });

    const result = await deploy('TKT-INTEG-3', 'production', {
      store: ticketStore(
        loadedTicket({
          ticketId: 'TKT-INTEG-3',
          solutionId: 'integration-sol-bg',
          gitSha: 'bg-sha-1',
          architecture: {
            devops: devopsSlice({
              deployStrategy: { strategy: 'blue-green' },
            }),
          },
        }),
      ),
      adapter,
      capabilityBroker: capabilityBroker(),
      steward,
      solutionMachine: machine,
      runId: () => runId,
      stewardPolling: { intervalMs: 1, freshnessWindowMs: 50 },
    });

    expect(result.status).toBe('deployed');
    expect(adapter.events.map((e) => e.phase)).toEqual(['green-up', 'cutover']);
  });
});

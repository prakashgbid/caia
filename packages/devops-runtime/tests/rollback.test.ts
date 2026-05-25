import { describe, expect, it } from 'vitest';
import { runRollback } from '../src/rollback.js';
import {
  devopsSlice,
  fakeClock,
  recordingAdapter,
  throwingAdapter,
} from './fixtures.js';

describe('runRollback', () => {
  it('snapshot method: restores using the architect-provided key', async () => {
    const adapter = recordingAdapter();
    const result = await runRollback({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      failedGitSha: 'bad-sha',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        rollbackContract: {
          trigger: 'healthcheck-failure',
          autoRevertWindowMin: 5,
          method: 'time-machine-snapshot',
          timeMachineSnapshotKey: 'snap-2026-05-25-pre-deploy',
        },
      }),
      reason: 'health red',
      clock: fakeClock(),
    });
    expect(result.attempted).toBe(true);
    expect(result.method).toBe('time-machine-snapshot');
    expect(result.ok).toBe(true);
    expect(adapter.calls[0]?.kind).toBe('restoreSnapshot');
  });

  it('snapshot method refuses when no key is configured', async () => {
    const result = await runRollback({
      adapter: recordingAdapter(),
      ticketId: 'TKT',
      solutionId: 'sol',
      failedGitSha: 'bad',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        rollbackContract: {
          trigger: 'healthcheck-failure',
          autoRevertWindowMin: 5,
          method: 'time-machine-snapshot',
        },
      }),
      reason: 'r',
      clock: fakeClock(),
    });
    expect(result.attempted).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('no timeMachineSnapshotKey');
  });

  it('snapshot method refuses when adapter lacks restoreSnapshot', async () => {
    const adapter = {
      applyPhase: async () => ({ ok: true, phase: 'x', durationMs: 1 }),
      rollbackPhase: async () => ({ ok: true, phase: 'x', durationMs: 1 }),
      // no restoreSnapshot
    } as any;
    const result = await runRollback({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      failedGitSha: 'bad',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice({
        rollbackContract: {
          trigger: 'healthcheck-failure',
          autoRevertWindowMin: 5,
          method: 'time-machine-snapshot',
          timeMachineSnapshotKey: 'snap-x',
        },
      }),
      reason: 'r',
      clock: fakeClock(),
    });
    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('does not implement restoreSnapshot');
  });

  it('git-revert: redeploys prior sha through the adapter', async () => {
    const adapter = recordingAdapter();
    const result = await runRollback({
      adapter,
      ticketId: 'TKT',
      solutionId: 'sol',
      failedGitSha: 'bad-sha',
      priorGitSha: 'good-sha',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      reason: 'health red',
      clock: fakeClock(),
    });
    expect(result.attempted).toBe(true);
    expect(result.method).toBe('git-revert-and-redeploy');
    expect(result.ok).toBe(true);
    expect(adapter.calls[0]?.kind).toBe('rollbackPhase');
    const callInput = adapter.calls[0]?.input as any;
    expect(callInput.gitSha).toBe('good-sha');
    expect(callInput.phase).toBe('rollback');
  });

  it('git-revert: refuses when priorGitSha is missing', async () => {
    const result = await runRollback({
      adapter: recordingAdapter(),
      ticketId: 'TKT',
      solutionId: 'sol',
      failedGitSha: 'bad',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      reason: 'r',
      clock: fakeClock(),
    });
    expect(result.attempted).toBe(false);
    expect(result.reason).toContain('no priorGitSha');
  });

  it('git-revert: records phase failure when adapter throws', async () => {
    const result = await runRollback({
      adapter: throwingAdapter('rb-boom'),
      ticketId: 'TKT',
      solutionId: 'sol',
      failedGitSha: 'bad',
      priorGitSha: 'good',
      targetEnv: 'production',
      capabilityTokenId: 'cap',
      devops: devopsSlice(),
      reason: 'r',
      clock: fakeClock(),
    });
    expect(result.attempted).toBe(true);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('rb-boom');
  });
});

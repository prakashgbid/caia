/**
 * Rollback contract executor.
 *
 * The architect's `devops.rollbackContract` specifies:
 *   - method: 'time-machine-snapshot' | 'git-revert-and-redeploy'
 *   - timeMachineSnapshotKey?: string (required for snapshot method)
 *   - autoRevertWindowMin: number (advisory; the api layer enforces it)
 *
 * For `time-machine-snapshot`, the adapter's `restoreSnapshot` is called
 * with the contract's snapshot key.
 * For `git-revert-and-redeploy`, we re-call `applyPhase` with a synthetic
 * `phase: 'rollback'` and the prior good sha (caller supplies it).
 *
 * The rollback uses the SAME capability token as the original deploy.
 * The token's TTL is sized by the architect's `secretsManagementInPipeline.tokenLifetimeMin`
 * — the api layer guarantees rollback runs inside that window.
 */

import type {
  ByocAdapter,
  DeployAdapterInput,
  DeployAdapterOutput,
  PhaseRecord,
  RollbackResult,
  ArchitectureDevopsSlice,
  TargetEnv,
} from './types.js';

export interface RollbackInput {
  adapter: ByocAdapter;
  ticketId: string;
  solutionId: string;
  /** Sha that was being deployed (the bad sha). */
  failedGitSha: string;
  /** Last-known-good sha. Required for `git-revert-and-redeploy`. */
  priorGitSha?: string;
  targetEnv: TargetEnv;
  capabilityTokenId: string;
  devops: ArchitectureDevopsSlice;
  reason: string;
  clock?: () => Date;
}

export async function runRollback(input: RollbackInput): Promise<RollbackResult> {
  const clock = input.clock ?? ((): Date => new Date());
  const startedAt = clock();
  const method = input.devops.rollbackContract.method;

  if (method === 'time-machine-snapshot') {
    return runSnapshotRollback(input, startedAt, clock);
  }
  if (method === 'git-revert-and-redeploy') {
    return runRevertRollback(input, startedAt, clock);
  }

  const finishedAt = clock();
  return {
    attempted: false,
    method: null,
    ok: false,
    reason: `unknown rollback method: ${method as string}`,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
  };
}

async function runSnapshotRollback(
  input: RollbackInput,
  startedAt: Date,
  clock: () => Date,
): Promise<RollbackResult> {
  const key = input.devops.rollbackContract.timeMachineSnapshotKey;
  if (!key) {
    const finishedAt = clock();
    return {
      attempted: false,
      method: 'time-machine-snapshot',
      ok: false,
      reason: 'rollbackContract.method=time-machine-snapshot but no timeMachineSnapshotKey supplied',
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }
  if (!input.adapter.restoreSnapshot) {
    const finishedAt = clock();
    return {
      attempted: false,
      method: 'time-machine-snapshot',
      ok: false,
      reason: 'adapter does not implement restoreSnapshot()',
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }
  const phaseStart = clock();
  let raw: DeployAdapterOutput;
  try {
    raw = await input.adapter.restoreSnapshot({
      ticketId: input.ticketId,
      solutionId: input.solutionId,
      targetEnv: input.targetEnv,
      snapshotKey: key,
      capabilityTokenId: input.capabilityTokenId,
    });
  } catch (err) {
    const finishedAt = clock();
    const reason = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      method: 'time-machine-snapshot',
      ok: false,
      reason: `restoreSnapshot threw: ${reason}`,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      phases: [
        {
          phase: 'snapshot-restore',
          ok: false,
          startedAtIso: phaseStart.toISOString(),
          finishedAtIso: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - phaseStart.getTime(),
          reason: `restoreSnapshot threw: ${reason}`,
        },
      ],
    };
  }
  const finishedAt = clock();
  const phase: PhaseRecord = {
    phase: 'snapshot-restore',
    ok: raw.ok,
    startedAtIso: phaseStart.toISOString(),
    finishedAtIso: finishedAt.toISOString(),
    durationMs: raw.durationMs || finishedAt.getTime() - phaseStart.getTime(),
  };
  if (raw.healthcheck) phase.healthcheck = raw.healthcheck;
  if (raw.reason) phase.reason = raw.reason;
  if (raw.undoToken) phase.undoToken = raw.undoToken;
  return {
    attempted: true,
    method: 'time-machine-snapshot',
    ok: raw.ok,
    reason: raw.ok ? `snapshot ${key} restored` : raw.reason ?? 'snapshot restore returned ok=false',
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    phases: [phase],
  };
}

async function runRevertRollback(
  input: RollbackInput,
  startedAt: Date,
  clock: () => Date,
): Promise<RollbackResult> {
  if (!input.priorGitSha) {
    const finishedAt = clock();
    return {
      attempted: false,
      method: 'git-revert-and-redeploy',
      ok: false,
      reason: 'rollbackContract.method=git-revert-and-redeploy but no priorGitSha supplied',
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  }
  const phaseStart = clock();
  const adapterInput: DeployAdapterInput = {
    ticketId: input.ticketId,
    solutionId: input.solutionId,
    gitSha: input.priorGitSha,
    targetEnv: input.targetEnv,
    strategy: input.devops.deployStrategy.strategy,
    phase: 'rollback',
    capabilityTokenId: input.capabilityTokenId,
    args: {
      rollbackReason: input.reason,
      failedGitSha: input.failedGitSha,
    },
  };
  let raw: DeployAdapterOutput;
  try {
    raw = await input.adapter.rollbackPhase(adapterInput);
  } catch (err) {
    const finishedAt = clock();
    const reason = err instanceof Error ? err.message : String(err);
    return {
      attempted: true,
      method: 'git-revert-and-redeploy',
      ok: false,
      reason: `rollbackPhase threw: ${reason}`,
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      phases: [
        {
          phase: 'rollback',
          ok: false,
          startedAtIso: phaseStart.toISOString(),
          finishedAtIso: finishedAt.toISOString(),
          durationMs: finishedAt.getTime() - phaseStart.getTime(),
          reason: `rollbackPhase threw: ${reason}`,
        },
      ],
    };
  }
  const finishedAt = clock();
  const phase: PhaseRecord = {
    phase: 'rollback',
    ok: raw.ok,
    startedAtIso: phaseStart.toISOString(),
    finishedAtIso: finishedAt.toISOString(),
    durationMs: raw.durationMs || finishedAt.getTime() - phaseStart.getTime(),
  };
  if (raw.healthcheck) phase.healthcheck = raw.healthcheck;
  if (raw.reason) phase.reason = raw.reason;
  if (raw.undoToken) phase.undoToken = raw.undoToken;
  return {
    attempted: true,
    method: 'git-revert-and-redeploy',
    ok: raw.ok,
    reason: raw.ok
      ? `git-revert-and-redeploy to ${input.priorGitSha} succeeded`
      : raw.reason ?? `rollback to ${input.priorGitSha} returned ok=false`,
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    phases: [phase],
  };
}

/**
 * `@caia/devops-runtime/api` — public entry point.
 *
 * `deploy(ticketId, targetEnv, config)` is the single function Stage 15
 * consumers call. It:
 *   1. Loads the ticket and reads `architecture.devops`.
 *   2. Runs the runner preflight (strategy supported + infra realism).
 *   3. Acquires a short-lived `deploy.production`/`cloudflare.pages.deploy.preview`
 *      capability via the broker.
 *   4. Dispatches to the strategy impl.
 *   5. Hands off to the steward for post-deploy verification.
 *   6. On any failure: runs the rollback contract.
 *   7. Drives the SolutionLifecycleMachine transition
 *      (`merged → deployed | deployed-failed | deployed-rolled-back`).
 *   8. Returns the typed `DeploymentResult`.
 */

import { randomUUID } from 'node:crypto';

import { runRollback } from './rollback.js';
import { dispatchStrategy, preflight } from './runner.js';
import { RuntimeStateMachine } from './state.js';
import type {
  DeployConfig,
  DeployEvent,
  DeployEventType,
  DeploymentResult,
  DeploymentStatus,
  LoadedDeployTicket,
  RollbackResult,
  RuntimeStateEvent,
  StateTransitionOutcome,
  StewardLedgerRow,
  StrategyResult,
  TargetEnv,
} from './types.js';
import type {
  SolutionState,
  SolutionTransitionResult,
  SolutionTriggeredBy,
} from '@caia/state-machine';
import { InvalidSolutionTransitionError, SolutionNotFoundError } from '@caia/state-machine';

const CAPABILITY_FOR_ENV: Record<TargetEnv, string> = {
  development: 'cloudflare.pages.deploy.preview',
  preview: 'cloudflare.pages.deploy.preview',
  staging: 'cloudflare.pages.deploy.preview',
  production: 'deploy.production',
};

export const ENTRY_STATE_SUCCESS: SolutionState = 'merged';
export const TARGET_STATE_SUCCESS: SolutionState = 'deployed';
export const TARGET_STATE_FAILED: SolutionState = 'deployed-failed';
export const TARGET_STATE_ROLLED_BACK: SolutionState = 'deployed-rolled-back';

export async function deploy(
  ticketId: string,
  targetEnv: TargetEnv,
  config: DeployConfig,
): Promise<DeploymentResult> {
  const clock = config.clock ?? ((): Date => new Date());
  const runId = (config.runId ?? ((): string => `deploy-${randomUUID()}`))();
  const startedAt = clock();

  const fsm = new RuntimeStateMachine({
    ticketId,
    clock,
    ...(config.onRuntimeState !== undefined ? { onTransition: config.onRuntimeState } : {}),
  });

  // ─── 1. load ticket ────────────────────────────────────────────────────
  fsm.transition('loading-spec', 'loading architecture.devops');
  let loaded: LoadedDeployTicket;
  try {
    loaded = await config.store.loadTicket(ticketId);
  } catch (err) {
    fsm.transition('failed', `loadTicket threw: ${err instanceof Error ? err.message : String(err)}`);
    return earlyFailure({
      ticketId,
      solutionId: ticketId,
      targetEnv,
      startedAt,
      finishedAt: clock(),
      runtimeStateTrace: fsm.trace,
      status: 'precondition-failed',
      reason: `loadTicket failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  emitDeployEvent(config, 'deploy.started', loaded, targetEnv, clock);

  // ─── 2. preflight ──────────────────────────────────────────────────────
  fsm.transition('preconditions-checking', 'strategy + infra realism');
  const preflightFailure = preflight(loaded.architecture.devops);
  if (preflightFailure) {
    fsm.transition('failed', preflightFailure.reason);
    const transition = await driveStateTransition({
      config,
      loaded,
      toState: TARGET_STATE_FAILED,
      reason: preflightFailure.reason,
    });
    emitDeployEvent(config, 'deploy.failed', loaded, targetEnv, clock, {
      durationMs: clock().getTime() - startedAt.getTime(),
      rollbackReason: preflightFailure.reason,
    });
    const status: DeploymentStatus =
      preflightFailure.kind === 'unsupported-strategy'
        ? 'unsupported-strategy'
        : 'precondition-failed';
    return {
      ticketId: loaded.ticketId,
      solutionId: loaded.solutionId,
      targetEnv,
      strategy: preflightFailure.kind === 'infra-mismatch' ? preflightFailure.strategy : null,
      status,
      durationMs: clock().getTime() - startedAt.getTime(),
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: clock().toISOString(),
      transition,
      runtimeStateTrace: fsm.trace,
      reason: preflightFailure.reason,
    };
  }

  // ─── 3. acquire capability ────────────────────────────────────────────
  fsm.transition('acquiring-capability', `acquiring ${CAPABILITY_FOR_ENV[targetEnv]}`);
  let capabilityTokenId: string;
  try {
    const tokenLifetimeMin =
      loaded.architecture.devops.secretsManagementInPipeline.tokenLifetimeMin ?? 30;
    const token = await config.capabilityBroker.issue({
      name: CAPABILITY_FOR_ENV[targetEnv],
      scope: scopeFor(loaded, targetEnv),
      agentRole: '@caia/devops-runtime',
      taskId: runId,
      requestedTtlMs: Math.min(60 * 60 * 1000, tokenLifetimeMin * 60_000),
      reason: `deploy ${loaded.ticketId} @ ${loaded.gitSha} → ${targetEnv}`,
    });
    capabilityTokenId = token.tokenId;
  } catch (err) {
    const reason = `capability issue failed: ${err instanceof Error ? err.message : String(err)}`;
    fsm.transition('failed', reason);
    const transition = await driveStateTransition({
      config,
      loaded,
      toState: TARGET_STATE_FAILED,
      reason,
    });
    emitDeployEvent(config, 'deploy.failed', loaded, targetEnv, clock, {
      durationMs: clock().getTime() - startedAt.getTime(),
      rollbackReason: reason,
    });
    return {
      ticketId: loaded.ticketId,
      solutionId: loaded.solutionId,
      targetEnv,
      strategy: loaded.architecture.devops.deployStrategy.strategy,
      status: 'deployed-failed',
      durationMs: clock().getTime() - startedAt.getTime(),
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: clock().toISOString(),
      transition,
      runtimeStateTrace: fsm.trace,
      reason,
    };
  }

  // ─── 4. deploy ────────────────────────────────────────────────────────
  fsm.transition('deploying', `dispatch ${loaded.architecture.devops.deployStrategy.strategy}`);
  const strategyOutcome = await dispatchStrategy({
    adapter: config.adapter,
    ticketId: loaded.ticketId,
    solutionId: loaded.solutionId,
    gitSha: loaded.gitSha,
    targetEnv,
    capabilityTokenId,
    devops: loaded.architecture.devops,
    clock,
  });

  if (strategyOutcome.kind !== 'ok') {
    fsm.transition('failed', strategyOutcome.reason);
    const rollback = await maybeRollback({
      config,
      loaded,
      targetEnv,
      capabilityTokenId,
      reason: strategyOutcome.reason,
      clock,
      fsm,
    });
    const transition = await driveStateTransition({
      config,
      loaded,
      toState: TARGET_STATE_FAILED,
      reason: strategyOutcome.reason,
    });
    emitDeployEvent(config, 'deploy.failed', loaded, targetEnv, clock, {
      durationMs: clock().getTime() - startedAt.getTime(),
      rollbackReason: strategyOutcome.reason,
    });
    return {
      ticketId: loaded.ticketId,
      solutionId: loaded.solutionId,
      targetEnv,
      strategy: loaded.architecture.devops.deployStrategy.strategy,
      status: 'deployed-failed',
      durationMs: clock().getTime() - startedAt.getTime(),
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: clock().toISOString(),
      transition,
      runtimeStateTrace: fsm.trace,
      capabilityTokenId,
      ...(rollback !== undefined ? { rollback } : {}),
      reason: strategyOutcome.reason,
    };
  }

  const strategyResult = strategyOutcome.result;

  if (!strategyResult.ok) {
    const failureReason = strategyResult.failureReason ?? 'strategy reported ok=false';
    fsm.transition('failed', failureReason);
    emitDeployEvent(config, 'deploy.healthcheck.failed', loaded, targetEnv, clock, {
      durationMs: clock().getTime() - startedAt.getTime(),
      rollbackReason: failureReason,
    });
    const rollback = await maybeRollback({
      config,
      loaded,
      targetEnv,
      capabilityTokenId,
      reason: failureReason,
      clock,
      fsm,
    });
    const transition = await driveStateTransition({
      config,
      loaded,
      toState: TARGET_STATE_FAILED,
      reason: failureReason,
    });
    emitDeployEvent(config, 'deploy.failed', loaded, targetEnv, clock, {
      durationMs: clock().getTime() - startedAt.getTime(),
      rollbackReason: failureReason,
    });
    return {
      ticketId: loaded.ticketId,
      solutionId: loaded.solutionId,
      targetEnv,
      strategy: loaded.architecture.devops.deployStrategy.strategy,
      status: 'deployed-failed',
      durationMs: clock().getTime() - startedAt.getTime(),
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: clock().toISOString(),
      transition,
      runtimeStateTrace: fsm.trace,
      capabilityTokenId,
      strategyResult,
      ...(rollback !== undefined ? { rollback } : {}),
      reason: failureReason,
    };
  }

  // ─── 5. steward verification ─────────────────────────────────────────
  fsm.transition('verifying', 'handoff to deploy-steward');
  const stewardRow = makeStewardRow({
    runId,
    loaded,
    targetEnv,
    clock,
    strategyResult,
  });
  await config.steward.recordDeploy(stewardRow);
  const verification = await config.steward.pollVerification(runId, {
    intervalMs: config.stewardPolling?.intervalMs ?? 1_000,
    freshnessWindowMs:
      config.stewardPolling?.freshnessWindowMs ??
      Math.max(60_000, (loaded.architecture.devops.rollbackContract.autoRevertWindowMin ?? 5) * 60_000),
    ...(config.stewardPolling?.clock !== undefined ? { clock: config.stewardPolling.clock } : {}),
  });

  if (verification.status !== 'green') {
    const verifyReason = `steward-${verification.status}: ${verification.reason}`;
    fsm.transition('failed', verifyReason);
    emitDeployEvent(config, 'deploy.healthcheck.failed', loaded, targetEnv, clock, {
      rollbackReason: verification.reason,
    });
    const rollback = await maybeRollback({
      config,
      loaded,
      targetEnv,
      capabilityTokenId,
      reason: verifyReason,
      clock,
      fsm,
    });
    const transition = await driveStateTransition({
      config,
      loaded,
      toState: TARGET_STATE_FAILED,
      reason: verifyReason,
    });
    emitDeployEvent(config, 'deploy.failed', loaded, targetEnv, clock, {
      durationMs: clock().getTime() - startedAt.getTime(),
      rollbackReason: verification.reason,
    });
    return {
      ticketId: loaded.ticketId,
      solutionId: loaded.solutionId,
      targetEnv,
      strategy: loaded.architecture.devops.deployStrategy.strategy,
      status: 'deployed-failed',
      durationMs: clock().getTime() - startedAt.getTime(),
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: clock().toISOString(),
      transition,
      runtimeStateTrace: fsm.trace,
      capabilityTokenId,
      strategyResult,
      stewardVerification: verification,
      ...(rollback !== undefined ? { rollback } : {}),
      reason: verifyReason,
    };
  }

  // ─── 6. success ───────────────────────────────────────────────────────
  fsm.transition('succeeded', 'strategy + steward both green');
  const transition = await driveStateTransition({
    config,
    loaded,
    toState: TARGET_STATE_SUCCESS,
    reason: 'deploy-and-verify-green',
    attestation: {
      steward: 'deploy-steward',
      id: runId,
      status: 'green',
      at: clock().toISOString(),
      evidence: {
        strategy: strategyResult.strategy,
        phaseCount: strategyResult.phases.length,
        verificationDurationMs: verification.durationMs,
      },
    },
  });
  emitDeployEvent(config, 'deploy.succeeded', loaded, targetEnv, clock, {
    durationMs: clock().getTime() - startedAt.getTime(),
    healthcheckLatencyMs: verification.durationMs,
  });

  return {
    ticketId: loaded.ticketId,
    solutionId: loaded.solutionId,
    targetEnv,
    strategy: loaded.architecture.devops.deployStrategy.strategy,
    status: 'deployed',
    durationMs: clock().getTime() - startedAt.getTime(),
    startedAtIso: startedAt.toISOString(),
    finishedAtIso: clock().toISOString(),
    transition,
    runtimeStateTrace: fsm.trace,
    capabilityTokenId,
    strategyResult,
    stewardVerification: verification,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────────

function scopeFor(loaded: LoadedDeployTicket, targetEnv: TargetEnv): string {
  return `${loaded.tenantId ?? 'default'}:${targetEnv}:${loaded.ticketId}`;
}

function makeStewardRow(params: {
  runId: string;
  loaded: LoadedDeployTicket;
  targetEnv: TargetEnv;
  clock: () => Date;
  strategyResult: StrategyResult;
}): StewardLedgerRow {
  const ts = params.clock().toISOString();
  const totalDuration = params.strategyResult.phases.reduce((sum, p) => sum + p.durationMs, 0);
  return {
    ts,
    id: params.runId,
    section: 'deploys',
    kind: 'deploy',
    node_id: params.loaded.solutionId,
    deploy_passed: true,
    deploy_rc: 0,
    deploy_reason: `${params.strategyResult.strategy} succeeded in ${params.strategyResult.phases.length} phases`,
    deploy_duration_ms: totalDuration,
    deploy_stdout: '',
    deploy_stderr: '',
    inuse_passed: false,
    inuse_rc: 0,
    inuse_reason: 'pending',
    inuse_duration_ms: 0,
    inuse_stdout: '',
    inuse_stderr: '',
    green: false,
  };
}

async function maybeRollback(params: {
  config: DeployConfig;
  loaded: LoadedDeployTicket;
  targetEnv: TargetEnv;
  capabilityTokenId: string;
  reason: string;
  clock: () => Date;
  fsm: RuntimeStateMachine;
}): Promise<RollbackResult | undefined> {
  const { config, loaded, targetEnv, capabilityTokenId, reason, clock, fsm } = params;
  const trigger = loaded.architecture.devops.rollbackContract.trigger;
  // Honor the architect's `trigger`: 'manual' means runtime does NOT auto-roll-back.
  if (trigger === 'manual') {
    return {
      attempted: false,
      method: loaded.architecture.devops.rollbackContract.method,
      ok: false,
      reason: 'rollback skipped: rollbackContract.trigger=manual (operator gate)',
      durationMs: 0,
    };
  }
  emitDeployEvent(config, 'deploy.rollback.triggered', loaded, targetEnv, clock, {
    rollbackReason: reason,
  });
  fsm.transition('rolling-back', reason);
  const result = await runRollback({
    adapter: config.adapter,
    ticketId: loaded.ticketId,
    solutionId: loaded.solutionId,
    failedGitSha: loaded.gitSha,
    targetEnv,
    capabilityTokenId,
    devops: loaded.architecture.devops,
    reason,
    clock,
  });
  fsm.transition(result.ok ? 'rolled-back' : 'rollback-failed', result.reason);
  return result;
}

function emitDeployEvent(
  config: DeployConfig,
  type: DeployEventType,
  loaded: LoadedDeployTicket,
  targetEnv: TargetEnv,
  clock: () => Date,
  extra: Partial<DeployEvent> = {},
): void {
  if (!config.onDeployEvent) return;
  const event: DeployEvent = {
    type,
    ticketId: loaded.ticketId,
    solutionId: loaded.solutionId,
    gitSha: loaded.gitSha,
    environment: targetEnv,
    strategy: loaded.architecture.devops.deployStrategy.strategy,
    atIso: clock().toISOString(),
    ...extra,
  };
  config.onDeployEvent(event);
}

async function driveStateTransition(params: {
  config: DeployConfig;
  loaded: LoadedDeployTicket;
  toState: SolutionState;
  reason: string;
  attestation?: {
    steward: string;
    id: string;
    status: 'green' | 'amber' | 'red';
    at: string;
    evidence?: Record<string, unknown>;
  };
}): Promise<StateTransitionOutcome> {
  const { config, loaded, toState, reason, attestation } = params;
  if (config.skipSolutionMachine || !config.solutionMachine) {
    return {
      attempted: false,
      toState,
      fromState: null,
      applied: false,
      reason: 'skipSolutionMachine or no solutionMachine configured',
    };
  }
  let sol;
  try {
    sol = await config.solutionMachine.getSolution(loaded.solutionId);
  } catch (err) {
    return {
      attempted: true,
      toState,
      fromState: null,
      applied: false,
      reason: `getSolution failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!sol) {
    return {
      attempted: true,
      toState,
      fromState: null,
      applied: false,
      reason: `solution ${loaded.solutionId} not found`,
    };
  }
  const fromState = sol.status;
  const triggeredBy: SolutionTriggeredBy = config.triggeredBy ?? {
    kind: 'agent',
    id: '@caia/devops-runtime',
  };
  try {
    const result: SolutionTransitionResult = await config.solutionMachine.advanceSolution(
      loaded.solutionId,
      toState,
      {
        reason,
        triggeredBy,
        payload: {
          ticketId: loaded.ticketId,
          gitSha: loaded.gitSha,
        },
        ...(attestation !== undefined ? { attestation } : {}),
      },
    );
    return {
      attempted: true,
      toState,
      fromState,
      applied: result.applied,
      reason: result.applied ? 'transition-applied' : 'idempotent-no-op',
      transitionResult: result,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let prefix = 'transition-error';
    if (err instanceof InvalidSolutionTransitionError) prefix = 'invalid-transition';
    else if (err instanceof SolutionNotFoundError) prefix = 'solution-not-found';
    return {
      attempted: true,
      toState,
      fromState,
      applied: false,
      reason: `${prefix}: ${msg}`,
    };
  }
}

function earlyFailure(params: {
  ticketId: string;
  solutionId: string;
  targetEnv: TargetEnv;
  startedAt: Date;
  finishedAt: Date;
  runtimeStateTrace: RuntimeStateEvent[];
  status: DeploymentStatus;
  reason: string;
}): DeploymentResult {
  return {
    ticketId: params.ticketId,
    solutionId: params.solutionId,
    targetEnv: params.targetEnv,
    strategy: null,
    status: params.status,
    durationMs: params.finishedAt.getTime() - params.startedAt.getTime(),
    startedAtIso: params.startedAt.toISOString(),
    finishedAtIso: params.finishedAt.toISOString(),
    transition: {
      attempted: false,
      toState: null,
      fromState: null,
      applied: false,
      reason: 'early-failure: state-machine transition skipped',
    },
    runtimeStateTrace: params.runtimeStateTrace,
    reason: params.reason,
  };
}

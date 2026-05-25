/**
 * Rolling deploy strategy.
 *
 * Adapter contract: one `applyPhase` call per batch. Batch count is
 * derived from `maxSurge` (default 1). For `maxSurge=N`, the runtime
 * issues N batches with phase `batch-i/N` and trafficSharePct
 * `Math.round((i / N) * 100)`. After each batch we inspect the
 * healthcheck snapshot and abort on first red.
 *
 * Strategy assumes the architect's `infrastructureAsCode.capabilities`
 * includes `multi-instance` per `STRATEGY_INFRA_REQUIREMENTS`.
 *
 * Note: the actual instance count is opaque to the runtime — the BYOC
 * adapter knows how many pods/instances exist. The `maxSurge` here is
 * interpreted as the *batch count* the adapter should drive (e.g.
 * maxSurge=3 → "I'll call you 3 times; please update 1/3 of instances
 * each call").
 */

import type {
  ByocAdapter,
  DeployAdapterInput,
  DeployAdapterOutput,
  PhaseRecord,
  StrategyResult,
  ArchitectureDevopsSlice,
  TargetEnv,
} from './types.js';

export interface RollingInput {
  adapter: ByocAdapter;
  ticketId: string;
  solutionId: string;
  gitSha: string;
  targetEnv: TargetEnv;
  capabilityTokenId: string;
  devops: ArchitectureDevopsSlice;
  clock?: () => Date;
}

export async function runRolling(input: RollingInput): Promise<StrategyResult> {
  const clock = input.clock ?? ((): Date => new Date());
  const batches = Math.max(1, input.devops.deployStrategy.maxSurge ?? 3);
  const phases: PhaseRecord[] = [];

  for (let i = 1; i <= batches; i++) {
    const phaseName = `batch-${i}/${batches}`;
    const trafficSharePct = Math.round((i / batches) * 100);
    const startedAt = clock();
    const adapterInput: DeployAdapterInput = {
      ticketId: input.ticketId,
      solutionId: input.solutionId,
      gitSha: input.gitSha,
      targetEnv: input.targetEnv,
      strategy: 'rolling',
      phase: phaseName,
      trafficSharePct,
      capabilityTokenId: input.capabilityTokenId,
      args: {
        healthcheckPath: input.devops.deployStrategy.healthcheckPath,
        maxSurge: input.devops.deployStrategy.maxSurge,
        maxUnavailable: input.devops.deployStrategy.maxUnavailable,
        batchIndex: i,
        batchCount: batches,
      },
    };
    let raw: DeployAdapterOutput;
    try {
      raw = await input.adapter.applyPhase(adapterInput);
    } catch (err) {
      const finishedAt = clock();
      const reason = err instanceof Error ? err.message : String(err);
      phases.push({
        phase: phaseName,
        ok: false,
        trafficSharePct,
        startedAtIso: startedAt.toISOString(),
        finishedAtIso: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        reason: `adapter threw: ${reason}`,
      });
      return {
        strategy: 'rolling',
        ok: false,
        phases,
        failureReason: `adapter threw on ${phaseName}: ${reason}`,
        failedPhaseIndex: phases.length - 1,
      };
    }
    const finishedAt = clock();
    const record: PhaseRecord = {
      phase: phaseName,
      ok: raw.ok,
      trafficSharePct,
      startedAtIso: startedAt.toISOString(),
      finishedAtIso: finishedAt.toISOString(),
      durationMs: raw.durationMs || finishedAt.getTime() - startedAt.getTime(),
    };
    if (raw.healthcheck) record.healthcheck = raw.healthcheck;
    if (raw.reason) record.reason = raw.reason;
    if (raw.undoToken) record.undoToken = raw.undoToken;
    phases.push(record);

    if (!raw.ok) {
      return {
        strategy: 'rolling',
        ok: false,
        phases,
        failureReason: raw.reason ?? `${phaseName} returned ok=false`,
        failedPhaseIndex: phases.length - 1,
      };
    }
    if (raw.healthcheck && !raw.healthcheck.ok) {
      return {
        strategy: 'rolling',
        ok: false,
        phases,
        failureReason: `healthcheck failed on ${phaseName}: status=${raw.healthcheck.status ?? 'n/a'}`,
        failedPhaseIndex: phases.length - 1,
      };
    }
  }

  return {
    strategy: 'rolling',
    ok: true,
    phases,
  };
}

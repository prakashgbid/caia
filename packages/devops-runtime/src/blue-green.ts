/**
 * Blue-green deploy strategy.
 *
 * Single-call adapter contract:
 *   1. provision GREEN (adapter.applyPhase with phase='green-up')
 *   2. healthcheck (the adapter is responsible for surfacing the result
 *      in DeployAdapterOutput.healthcheck)
 *   3. atomic traffic-switch (adapter.applyPhase with phase='cutover')
 *   4. retain BLUE for `architect.deployStrategy.dwellMin` minutes — the
 *      runtime does NOT sleep for that window (the rollback layer reads
 *      `dwellMin` if it needs to abort).
 *
 * On any phase failure: stop early, return `ok: false`, let the api layer
 * dispatch to the rollback executor.
 *
 * Strategy assumes the BYOC adapter exposes blue+green endpoints under
 * the same `applyPhase` API; the architect's `infrastructureAsCode.capabilities`
 * must include `two-identical-environments` per `STRATEGY_INFRA_REQUIREMENTS`.
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

export interface BlueGreenInput {
  adapter: ByocAdapter;
  ticketId: string;
  solutionId: string;
  gitSha: string;
  targetEnv: TargetEnv;
  capabilityTokenId: string;
  devops: ArchitectureDevopsSlice;
  clock?: () => Date;
}

export async function runBlueGreen(input: BlueGreenInput): Promise<StrategyResult> {
  const clock = input.clock ?? ((): Date => new Date());
  const phases: PhaseRecord[] = [];

  for (const phaseName of ['green-up', 'cutover'] as const) {
    const startedAt = clock();
    const adapterInput: DeployAdapterInput = {
      ticketId: input.ticketId,
      solutionId: input.solutionId,
      gitSha: input.gitSha,
      targetEnv: input.targetEnv,
      strategy: 'blue-green',
      phase: phaseName,
      capabilityTokenId: input.capabilityTokenId,
      args: {
        healthcheckPath: input.devops.deployStrategy.healthcheckPath,
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
        startedAtIso: startedAt.toISOString(),
        finishedAtIso: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        reason: `adapter threw: ${reason}`,
      });
      return {
        strategy: 'blue-green',
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
        strategy: 'blue-green',
        ok: false,
        phases,
        failureReason: raw.reason ?? `${phaseName} returned ok=false`,
        failedPhaseIndex: phases.length - 1,
      };
    }
    if (raw.healthcheck && !raw.healthcheck.ok) {
      return {
        strategy: 'blue-green',
        ok: false,
        phases,
        failureReason: `healthcheck failed on ${phaseName}: status=${raw.healthcheck.status ?? 'n/a'}`,
        failedPhaseIndex: phases.length - 1,
      };
    }
  }

  return {
    strategy: 'blue-green',
    ok: true,
    phases,
  };
}

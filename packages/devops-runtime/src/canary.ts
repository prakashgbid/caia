/**
 * Canary deploy strategy.
 *
 * Multi-call adapter contract:
 *   - For each step in `trafficShiftSchedule` (default [10, 50, 100]):
 *     1. adapter.applyPhase({ phase: `canary-${pct}`, trafficSharePct: pct })
 *     2. inspect healthcheck snapshot
 *     3. on `ok && healthcheck.ok` → next step
 *     4. on `!ok || (healthcheck && !healthcheck.ok)` → stop and return
 *        `{ok: false}` — the api layer dispatches rollback.
 *
 * The runtime does NOT enforce dwell time between steps (the adapter
 * is expected to enforce its own dwell, since CDN/edge propagation is
 * vendor-specific). The `dwellMin` is forwarded as adapter args.
 *
 * Strategy assumes the architect's `infrastructureAsCode.capabilities`
 * includes `traffic-split` per `STRATEGY_INFRA_REQUIREMENTS`.
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

const DEFAULT_SCHEDULE = [10, 50, 100] as const;

export interface CanaryInput {
  adapter: ByocAdapter;
  ticketId: string;
  solutionId: string;
  gitSha: string;
  targetEnv: TargetEnv;
  capabilityTokenId: string;
  devops: ArchitectureDevopsSlice;
  clock?: () => Date;
}

export async function runCanary(input: CanaryInput): Promise<StrategyResult> {
  const clock = input.clock ?? ((): Date => new Date());
  const schedule = input.devops.deployStrategy.trafficShiftSchedule ?? [...DEFAULT_SCHEDULE];
  const phases: PhaseRecord[] = [];

  for (const pct of schedule) {
    const phaseName = `canary-${pct}`;
    const startedAt = clock();
    const adapterInput: DeployAdapterInput = {
      ticketId: input.ticketId,
      solutionId: input.solutionId,
      gitSha: input.gitSha,
      targetEnv: input.targetEnv,
      strategy: 'canary',
      phase: phaseName,
      trafficSharePct: pct,
      capabilityTokenId: input.capabilityTokenId,
      args: {
        healthcheckPath: input.devops.deployStrategy.healthcheckPath,
        dwellMin: input.devops.deployStrategy.dwellMin,
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
        trafficSharePct: pct,
        startedAtIso: startedAt.toISOString(),
        finishedAtIso: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        reason: `adapter threw: ${reason}`,
      });
      return {
        strategy: 'canary',
        ok: false,
        phases,
        failureReason: `adapter threw at ${pct}%: ${reason}`,
        failedPhaseIndex: phases.length - 1,
      };
    }
    const finishedAt = clock();
    const record: PhaseRecord = {
      phase: phaseName,
      ok: raw.ok,
      trafficSharePct: pct,
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
        strategy: 'canary',
        ok: false,
        phases,
        failureReason: raw.reason ?? `canary ${pct}% returned ok=false`,
        failedPhaseIndex: phases.length - 1,
      };
    }
    if (raw.healthcheck && !raw.healthcheck.ok) {
      return {
        strategy: 'canary',
        ok: false,
        phases,
        failureReason: `healthcheck failed at canary ${pct}%: status=${raw.healthcheck.status ?? 'n/a'}`,
        failedPhaseIndex: phases.length - 1,
      };
    }
  }

  return {
    strategy: 'canary',
    ok: true,
    phases,
  };
}

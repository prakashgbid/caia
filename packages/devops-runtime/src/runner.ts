/**
 * Runner: reads `ticket.architecture.devops` and dispatches to a
 * strategy impl.
 *
 * The runner does NOT touch the canonical state machine — that's the
 * api layer's job. It also does NOT acquire capabilities — that's also
 * the api layer, so the capability is held across the entire
 * deploy + rollback span.
 *
 * The runner DOES validate strategy-vs-infrastructure realism using the
 * architect's `STRATEGY_INFRA_REQUIREMENTS`. If the architect emitted a
 * `canary` strategy but `infrastructureAsCode.capabilities` doesn't
 * include `traffic-split`, the runner refuses with `'infra-mismatch'`.
 */

import { runBlueGreen } from './blue-green.js';
import { runCanary } from './canary.js';
import { runRolling } from './rolling.js';
import type {
  ArchitectureDevopsSlice,
  ByocAdapter,
  DeployStrategyName,
  StrategyResult,
  TargetEnv,
} from './types.js';
import { RUNTIME_DEPLOY_STRATEGIES } from './types.js';

/** Strategy → required infra capabilities. Mirrors
 * `@caia/devops-architect.STRATEGY_INFRA_REQUIREMENTS` so the runtime
 * can refuse impossible deploys without a runtime import of the
 * architect (avoids a circular dep). The architect's golden test
 * enforces the two are in sync. */
export const STRATEGY_INFRA_REQUIREMENTS: Readonly<Record<DeployStrategyName, readonly string[]>> = {
  'blue-green': ['two-identical-environments'],
  'canary': ['traffic-split'],
  'rolling': ['multi-instance'],
  'ring-deployment': ['multi-region'],
  'recreate': [],
};

export type RunnerOutcome =
  | { kind: 'ok'; result: StrategyResult }
  | { kind: 'unsupported-strategy'; strategy: string; reason: string }
  | {
      kind: 'infra-mismatch';
      strategy: DeployStrategyName;
      missing: string[];
      reason: string;
    };

export interface RunnerInput {
  adapter: ByocAdapter;
  ticketId: string;
  solutionId: string;
  gitSha: string;
  targetEnv: TargetEnv;
  capabilityTokenId: string;
  devops: ArchitectureDevopsSlice;
  clock?: () => Date;
}

export function isRuntimeDeployStrategy(value: string): value is DeployStrategyName {
  return (RUNTIME_DEPLOY_STRATEGIES as readonly string[]).includes(value);
}

/** Check whether the architect-emitted spec is implementable. Used by
 * the api layer before acquiring a capability so we fail fast. */
export function preflight(devops: ArchitectureDevopsSlice): Exclude<RunnerOutcome, { kind: 'ok' }> | null {
  const strategy = devops.deployStrategy.strategy as string;
  if (!isRuntimeDeployStrategy(strategy)) {
    return {
      kind: 'unsupported-strategy',
      strategy,
      reason: `runtime does not implement strategy '${strategy}'; supported: ${RUNTIME_DEPLOY_STRATEGIES.join(', ')}`,
    };
  }
  const required = STRATEGY_INFRA_REQUIREMENTS[strategy];
  const have = new Set(devops.infrastructureAsCode.capabilities);
  const missing = required.filter((cap) => !have.has(cap));
  if (missing.length > 0) {
    return {
      kind: 'infra-mismatch',
      strategy,
      missing,
      reason: `strategy '${strategy}' requires infra capabilities [${missing.join(', ')}] but they are not in architect's infrastructureAsCode.capabilities`,
    };
  }
  return null;
}

/** Dispatch to the strategy impl. Preflight is the caller's responsibility
 * (so the api layer can short-circuit before acquiring the capability). */
export async function dispatchStrategy(input: RunnerInput): Promise<RunnerOutcome> {
  const preflightFailure = preflight(input.devops);
  if (preflightFailure) return preflightFailure;

  const strategy = input.devops.deployStrategy.strategy as DeployStrategyName;
  const baseInput = {
    adapter: input.adapter,
    ticketId: input.ticketId,
    solutionId: input.solutionId,
    gitSha: input.gitSha,
    targetEnv: input.targetEnv,
    capabilityTokenId: input.capabilityTokenId,
    devops: input.devops,
    ...(input.clock !== undefined ? { clock: input.clock } : {}),
  };
  switch (strategy) {
    case 'blue-green':
      return { kind: 'ok', result: await runBlueGreen(baseInput) };
    case 'canary':
      return { kind: 'ok', result: await runCanary(baseInput) };
    case 'rolling':
      return { kind: 'ok', result: await runRolling(baseInput) };
    case 'ring-deployment':
    case 'recreate':
      return {
        kind: 'unsupported-strategy',
        strategy,
        reason: `runtime accepts '${strategy}' but the impl is gated behind a follow-up ticket; refusing rather than running an unsafe deploy`,
      };
    default: {
      const _exhaustive: never = strategy;
      void _exhaustive;
      return {
        kind: 'unsupported-strategy',
        strategy,
        reason: `unreachable strategy ${strategy}`,
      };
    }
  }
}

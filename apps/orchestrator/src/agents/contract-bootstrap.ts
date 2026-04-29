/**
 * Contract bootstrap (ACR-009).
 *
 * One-time registration of every Phase-1 agent's SectionContract on the
 * default singleton @chiefaia/agent-contract-registry. The orchestrator
 * boot path imports this; the dashboard /contracts route imports it too
 * so it can render composed templates per scope.
 *
 * Idempotent — safe to call from multiple boot paths in tests; uses
 * `replace()` so a second call is a no-op rather than a throw.
 */

import {
  getDefaultRegistry,
  type ContractRegistry,
} from '@chiefaia/agent-contract-registry';
import type { SectionContract } from '@chiefaia/ticket-template';
import { poAgentContract } from './po-agent.contract';
import { baAgentContract } from './ba-agent.contract';
import { eaAgentContract } from './ea-agent.contract';
import { testDesignAgentContract } from './test-design-agent.contract';

/** All Phase-1 contracts in pipeline order — exported for tests + dashboards. */
export const PHASE1_CONTRACTS: readonly SectionContract[] = [
  poAgentContract,
  baAgentContract,
  eaAgentContract,
  testDesignAgentContract,
];

let bootstrapped = false;

/**
 * Register every Phase-1 contract on the default singleton registry.
 * Idempotent — second call is a no-op.
 *
 * Returns the registry for chaining / inspection.
 */
export function bootstrapAgentContracts(): ContractRegistry {
  const reg = getDefaultRegistry();
  if (bootstrapped) return reg;
  for (const contract of PHASE1_CONTRACTS) {
    reg.replace(contract);
  }
  bootstrapped = true;
  return reg;
}

/** Test-only: clear the bootstrap flag so the next call re-registers. */
export function resetBootstrapFlag(): void {
  bootstrapped = false;
}

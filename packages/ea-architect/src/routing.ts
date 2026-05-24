/**
 * Coordinator routing table — deterministic, NOT LLM-decided.
 *
 * Reference: spec §4.1, §5.1. The Coordinator should not reason about
 * routing when the submission type already declares it.
 */

import type { CoordinatorPlanType, SubAgentId } from './coordinator-types.js';

/** The canonical routing table per spec §4.1. */
export const ROUTING_TABLE: Record<CoordinatorPlanType, ReadonlyArray<SubAgentId>> = {
  research: ['ea-plan-reviewer'],
  spec: ['ea-plan-reviewer'],
  implementation: ['ea-plan-reviewer'],
  // Implementation plans always touch tickets; Auditor reviews ticket-level
  // completeness assumptions in addition to the Plan Reviewer.
  'implementation-plan': ['ea-plan-reviewer', 'ea-ticket-auditor'],
  'architecture-change': ['ea-plan-reviewer'],
  // Process changes need a check against existing principle-violation patterns.
  'process-change': ['ea-plan-reviewer', 'ea-drift-sentinel'],
  'ticket-completeness-check': ['ea-ticket-auditor'],
  'research-request': ['ea-research-conductor'],
  'repository-maintenance': ['ea-doc-steward'],
  'drift-alert': ['ea-drift-sentinel']
};

/** Returns the sub-agents to invoke for a given plan type. */
export function routeFor(planType: CoordinatorPlanType): ReadonlyArray<SubAgentId> {
  return ROUTING_TABLE[planType] ?? [];
}

/** True iff this plan type involves a Plan Reviewer (and therefore a Defender). */
export function involvesPlanReviewer(planType: CoordinatorPlanType): boolean {
  return routeFor(planType).includes('ea-plan-reviewer');
}

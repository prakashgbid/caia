/**
 * @caia/ea-ticket-auditor — public surface.
 *
 * The pre-architecture gate: runs the 15-point DoD checks + ensures
 * non-functional sibling stories exist under the parent epic.
 *
 * Reference: research/ea_agent_operational_framework_2026.md §4.3.
 */

export { EaTicketAuditor } from './auditor.js';
export { DEFAULT_DOD_CHECKS } from './dod-checklist.js';
export { findMissingNonFunctional } from './non-functional-detector.js';
export type {
  TicketAuditInput,
  TicketAuditVerdict,
  TicketAuditorConfig,
  DodCheckItem,
  DodCheckResult
} from './types.js';

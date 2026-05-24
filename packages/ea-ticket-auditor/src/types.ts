/**
 * @caia/ea-ticket-auditor — public types.
 *
 * Reference: spec §4.3.
 */

import type { PlanContextDump, PlanDefenderSpawner } from '@caia/plan-defender';

/** The 15-point Definition of Done from CAIA's framework. */
export interface DodCheckItem {
  id: string; // e.g. "DoD-01"
  title: string;
  /** Predicate run against the ticket body. */
  check: (ticketBody: string) => DodCheckResult;
}

export interface DodCheckResult {
  pass: boolean;
  evidence?: string;
  reason?: string;
}

/** Input the Coordinator passes to the Auditor. */
export interface TicketAuditInput {
  ticketId: string;
  ticketBody: string;
  /** Sibling stories under the same parent epic — for non-functional coverage. */
  siblingStories?: Array<{ id: string; body: string }>;
  /** Optional context dump (only when the ticket's author session has closed). */
  contextDump?: PlanContextDump;
  /** Spawner — only used if contextDump is present. */
  spawner?: PlanDefenderSpawner;
  /** Submission id for traceability. */
  submissionId: string;
}

/** A single audit verdict from the Auditor. */
export interface TicketAuditVerdict {
  ticketId: string;
  pass: boolean;
  /** Per-DoD-item results. */
  dodResults: Array<{ id: string; title: string; pass: boolean; reason?: string }>;
  /** Missing non-functional stories the Auditor recommends adding. */
  missingNonFunctional: string[];
  /** 0..1 completeness score: passed_checks / total_checks. */
  completenessScore: number;
  /** ISO timestamp. */
  reviewedAtIso: string;
  /** Reasoning summary (1-3 sentences). */
  reasoning: string;
}

/** Auditor config. */
export interface TicketAuditorConfig {
  /** Override the DoD checks. */
  dodChecks?: DodCheckItem[];
  clock?: () => Date;
}

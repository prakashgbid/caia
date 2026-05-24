/**
 * @caia/ea-architect — public surface.
 *
 * The EA Architect Agent is CAIA's platform-level approval gate. Every
 * future research / spec / implementation / architecture-change /
 * process-change plan goes through this agent BEFORE reaching the
 * operator. The agent reviews against the full EA Repository (ADRs,
 * principles, lessons, risk register, operator feedback memories) and
 * issues a structured ReviewOutcome.
 *
 * Distinct from `@caia/ea-reviewer`: that one audits per-ticket composed
 * architecture from the 17 specialist architects; this one audits
 * platform plans. See ADR-040 for the scope split.
 *
 * Subscription-only LLM use per P1 + P14 (no API key); reaches Claude
 * via `@chiefaia/claude-spawner`.
 */

export { EaArchitectAgent, submitPlan } from './agent.js';

// Types — the contract callers depend on.
export type {
  PlanSubmission,
  PlanType,
  ReviewOutcome,
  ReviewStatus,
  ReviewHistory,
  ReviewHistoryEntry,
  EaReviewState,
  EaReviewEvent,
  EaReviewEventHandler,
  EaEventBus,
  EscalationReason,
  OperatorEscalation,
  NewAdrDraft,
  AffectedAdr,
  ModelTier,
  EaArchitectConfig,
  CriticAdapter,
  CriticInput,
  CriticOutput,
  FsAdapter,
  Clock,
  AdrRecord,
  PrincipleRecord,
  LessonRecord,
  RiskRecord,
  FeedbackRecord,
  EaRepository,
  RelevanceMatch,
  RelevantContext
} from './types.js';

// Sub-module exports for callers that want lower-level access.
export {
  loadRepository,
  selectRelevantContext,
  tokenise,
  extractAdrIds
} from './repository-loader.js';

export {
  EA_ARCHITECT_SYSTEM_PROMPT,
  buildCriticPrompt,
  createDefaultCritic,
  parseCriticOutput,
  applyHallucinationGuard
} from './critic.js';

export {
  slugifyTitle,
  formatAdrId,
  renderAdrMarkdown,
  writeNewAdr,
  markSupersededBy,
  patchSupersededBy,
  applySupersessions,
  updateDecisionsIndex
} from './adr-writer.js';

export {
  ESCALATION_SECTION_HEADER,
  renderEscalationEntry,
  appendEscalationToInbox,
  detectStrategicEscalation
} from './escalation.js';

export {
  EA_REVIEW_VALID_TRANSITIONS,
  EA_REVIEW_TERMINAL_STATES,
  canEaReviewTransition,
  isEaReviewTerminal,
  chooseTargetState,
  eventTypeFor,
  buildEvent,
  InProcessEventBus
} from './state.js';

export { defaultFsAdapter, InMemoryFsAdapter } from './fs-adapter.js';

/**
 * Agent contract — register with @chiefaia/agent-contract-registry to
 * declare which sections the EA Architect Agent owns. Plan-submission
 * objects are not ticket sections per se (the registry's primary
 * consumer), but this declaration documents the API for the orchestrator.
 *
 * Format intentionally minimal to avoid coupling to the registry's
 * exact shape, which may evolve. Adapters can map this to the registry
 * format when integration lands.
 */
export const EA_ARCHITECT_CONTRACT = Object.freeze({
  agentId: '@caia/ea-architect' as const,
  role: 'platform-approval-gate' as const,
  consumesEvents: ['ea-architect.submit-plan'] as const,
  emitsEvents: [
    'ea-architect.review.pending',
    'ea-architect.review.revisions-requested',
    'ea-architect.review.approved',
    'ea-architect.review.conditional-approval',
    'ea-architect.review.rejected',
    'ea-architect.review.escalated-to-operator'
  ] as const,
  artifacts: {
    reads: [
      'caia-ea/decisions/**',
      'caia-ea/principles/**',
      'caia-ea/lessons-learned/**',
      'caia-ea/risk-register/**',
      'agent-memory/feedback_*.md',
      'agent-memory/project_caia_*.md'
    ],
    writes: ['caia-ea/decisions/ADR-NNN-*.md', 'caia-ea/decisions/INDEX.md', 'agent-memory/INBOX.md']
  }
});

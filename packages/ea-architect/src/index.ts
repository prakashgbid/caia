/**
 * @caia/ea-architect — public surface.
 *
 * The EA Architect Agent began life (PR #556) as CAIA's platform-level
 * approval gate — a single-pass critic that reviews any plan against the
 * EA Repository (ADRs, principles, lessons, risk register, operator
 * feedback memories) and issues a structured ReviewOutcome.
 *
 * After the operational-framework spec (research/ea_agent_operational_framework_2026.md),
 * this same package now ALSO hosts the EA Coordinator role — the multi-
 * sub-agent orchestrator that routes submissions to specialised sub-
 * agents (@caia/ea-plan-reviewer, @caia/ea-ticket-auditor, etc.),
 * aggregates verdicts per a precedence ladder, composes operator-facing
 * sign-off documents, and emits state-machine transitions.
 *
 * Both APIs are exported. The single-pass `EaArchitectAgent` + `submitPlan`
 * remain for backwards compatibility. New code should prefer
 * `EaCoordinator` with sub-agent adapters wired via config.
 *
 * Distinct from `@caia/ea-reviewer`: that one audits per-ticket composed
 * architecture from the 17 specialist architects; this one audits
 * platform plans. See ADR-040 for the scope split.
 */

// -- Backwards-compat single-pass agent -------------------------------------
export { EaArchitectAgent, submitPlan } from './agent.js';

// -- Coordinator (new in the operational framework) -------------------------
export { EaCoordinator, ValidationFailure, type EaCoordinatorConfig } from './coordinator.js';
export { ROUTING_TABLE, routeFor, involvesPlanReviewer } from './routing.js';
export {
  pickDominantVerdict,
  aggregateVerdicts
} from './aggregation.js';
export {
  SignoffComposer,
  renderSignoffMarkdown,
  computeReadTimeMinutes,
  type SignoffComposerConfig,
  type SignoffComposeInput
} from './signoff-composer.js';
export type {
  CoordinatorPlanType,
  CoordinatorPlanSubmission,
  CoordinatorContextDump,
  CoordinatorReviewOutcome,
  CoordinatorValidationResult,
  SubAgentId,
  SubAgentVerdict,
  PlanReviewerAdapter,
  PlanReviewerAdapterInput,
  TicketAuditorAdapter,
  DocStewardAdapter,
  ResearchConductorAdapter,
  DriftSentinelAdapter
} from './coordinator-types.js';

// -- Types (existing) --------------------------------------------------------
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

// -- Sub-module exports for callers that want lower-level access ------------
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
 * Agent contract — declares which sections this package emits / consumes.
 * Extended for the Coordinator role.
 */
export const EA_ARCHITECT_CONTRACT = Object.freeze({
  agentId: '@caia/ea-architect' as const,
  role: 'coordinator-and-platform-approval-gate' as const,
  consumesEvents: [
    'ea-architect.submit-plan',
    'ea-coordinator.submit-plan'
  ] as const,
  emitsEvents: [
    'ea-architect.review.pending',
    'ea-architect.review.revisions-requested',
    'ea-architect.review.approved',
    'ea-architect.review.conditional-approval',
    'ea-architect.review.rejected',
    'ea-architect.review.escalated-to-operator',
    'ea-coordinator.routing',
    'ea-coordinator.aggregating',
    'ea-coordinator.signoff-ready',
    'ea-coordinator.approved',
    'ea-coordinator.conditional',
    'ea-coordinator.rejected',
    'ea-coordinator.escalated-to-operator'
  ] as const,
  artifacts: {
    reads: [
      'caia-ea/decisions/**',
      'caia-ea/principles/**',
      'caia-ea/lessons-learned/**',
      'caia-ea/risk-register/**',
      'agent-memory/feedback_*.md',
      'agent-memory/project_caia_*.md',
      'caia-ea/dialogues/*.jsonl'
    ],
    writes: [
      'caia-ea/decisions/ADR-NNN-*.md',
      'caia-ea/decisions/INDEX.md',
      'caia-ea/sign-offs/*.md',
      'caia-ea/sign-offs/INDEX.md',
      'agent-memory/INBOX.md'
    ]
  }
});

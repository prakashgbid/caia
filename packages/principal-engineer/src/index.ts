/**
 * @caia/principal-engineer — Stage 12 of CAIA's canonical pipeline.
 *
 * Public surface. Everything else stays internal.
 *
 * See PLAN.md for the architecture rationale + EA-REVIEW-OUTCOME.json
 * for the EA Architect approval.
 */

// -- Dependency graph (pure) -------------------------------------------------
export {
  buildDependencyGraph,
  detectCycles,
  groupByLevel,
  tarjanSccs,
  topoLevels,
  DependencyGraphError,
} from './dependency-graph.js';

// -- Bucketer ----------------------------------------------------------------
export {
  bucketTickets,
  resolvePerWaveCap,
  DEFAULT_BUCKET_POLICIES,
  DEFAULT_PER_WAVE_CAP,
} from './bucketer.js';

// -- Worker pool -------------------------------------------------------------
export {
  WorkerPool,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_WORKER_TTL_SECONDS,
} from './worker-pool.js';

// -- Dispatcher --------------------------------------------------------------
export {
  Dispatcher,
  DEFAULT_SPAWN_TIMEOUT_MS,
  DEFAULT_TRIGGERED_BY,
  composePrompt,
  renderDefaultUserPrompt,
} from './dispatcher.js';

// -- High-level scheduler ----------------------------------------------------
export { schedule } from './scheduler.js';

// -- HTTP adapter ------------------------------------------------------------
export { createScheduleHandler, parseScheduleBody, SCHEDULE_ROUTE } from './api.js';

// -- Types -------------------------------------------------------------------
export { TIER_CAPS } from './types.js';
export type {
  BucketInput,
  BucketKind,
  CycleReport,
  DispatchAttempt,
  ScheduleInput,
  ScheduleRequestShape,
  ScheduleResponseShape,
  ScheduleResult,
  Scc,
  SchedulerConfig,
  SchedulerStateMachine,
  SpawnFn,
  SpsBucketPolicies,
  TenantTier,
  Ticket,
  TicketGraph,
  TopoLevel,
  WaveBucket,
  WavePlan,
  WorkerRegistration,
  WorkerStatus,
} from './types.js';

/**
 * Agent contract — what this package emits / consumes against the canonical
 * pipeline. Mirrors the EA_ARCHITECT_CONTRACT pattern.
 */
export const PRINCIPAL_ENGINEER_CONTRACT = Object.freeze({
  agentId: '@caia/principal-engineer' as const,
  pipelineStage: 12 as const,
  consumesStates: ['tests-reviewed'] as const,
  emitsStates: ['scheduled', 'scheduling-failed'] as const,
  emitsEvents: [
    'principal-engineer.scheduled',
    'principal-engineer.scheduling-failed',
    'principal-engineer.cycle-detected',
  ] as const,
});

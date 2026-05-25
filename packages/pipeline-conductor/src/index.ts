/**
 * @caia/pipeline-conductor — Pipeline Status Manager Agent.
 * Public surface. Per research/conductor_agent_spec_2026.md §6
 * + research/ai_first_continuous_discipline_2026.md §7 (Layer 5).
 */

export { ConductorClient } from './api.js';
export type { ConductorClientOptions } from './api.js';

export { Projector } from './projector.js';
export type { ProjectorOptions } from './projector.js';

export {
  Forecaster,
  computeStageForecastFromSamples,
  stagesAfter,
} from './forecaster.js';
export type { StageForecast, ForecasterOptions } from './forecaster.js';

export {
  DEFAULT_STAGE_THRESHOLDS,
  REPEATED_FAILURE_POLICY,
  WATCHDOG_TICK_SECONDS,
  SEVERITY_ESCALATION_MULTIPLIER,
  loadEscalationPolicies,
  checkStuck,
} from './escalation-policies.js';
export type {
  EscalationPolicyMap,
  StageThresholds,
  StuckCheckInput,
  StuckCheckResult,
} from './escalation-policies.js';

export { STAGE_NAMES, isStageName } from './types.js';
export type {
  StageName,
  OperatorProjectStatus,
  StuckProject,
  StageHistoryEntry,
  PipelineHealth,
  StageHealth,
  OpenEscalation,
  StateTransition,
  FailureEvent,
  AgentActivity,
  ProjectForecast,
  EscalationResolution,
  EscalationResult,
} from './types.js';

// ─── AI-First Continuous Discipline — Layer 5 ──────────────────────────────
export {
  DriftDetector,
  DEFAULT_SOURCE_GLOBS,
  DRIFT_DETECTOR_ACTOR,
} from './drift-detector.js';
export type {
  DriftDetectorOptions,
  PolicyViolationInput,
  MemoryInconsistencyInput,
  PrincipleViolationInput,
} from './drift-detector.js';

export {
  Alerter,
  DRIFT_EVENT_TYPES,
  INBOX_SECTION_HEADER,
  InMemoryAlerterFs,
  isDriftEventType,
  renderAlertEntry,
} from './alerter.js';
export type {
  AlerterOptions,
  AlerterFsAdapter,
  DriftEventType,
  OperatorNotifier,
  OperatorNotification,
} from './alerter.js';

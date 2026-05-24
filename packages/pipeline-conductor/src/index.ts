/**
 * @caia/pipeline-conductor — Pipeline Status Manager Agent.
 * Public surface. Per research/conductor_agent_spec_2026.md §6.
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

/**
 * @caia/qa-engineer — production verifier.
 *
 * Public surface re-exports. See README.md and PLAN.md for the canonical
 * FSM slot (`deployed -> verified` | `deployed -> verify-failed`).
 */

export {
  validateInProduction,
  decideVerdict,
  buildRollbackRecommendation,
  decideSeverity,
  summarisePlaywrightForLog,
  failedSpecIds,
} from './api.js';

export {
  buildRunPlan,
  createSpawnPlaywrightAdapter,
  createStubPlaywrightAdapter,
  parsePlaywrightJson,
  countRequiredFailures,
} from './agent.js';
export type {
  BuildRunPlanOptions,
  SpawnAdapterOptions,
  StubAdapterOptions,
} from './agent.js';

export {
  createDefaultSpecStrategy,
  listSpecFiles,
  isSpecFile,
  rewriteBaseUrl,
  stripTrailingSlash,
  buildPlaywrightEnv,
  NODE_FS_ADAPTER,
} from './test-strategy.js';
export type {
  DefaultSpecStrategyOptions,
  FsAdapter,
} from './test-strategy.js';

export {
  createDefaultOutcomeStewardAdapter,
  countByStatusPure,
  classifyVerdict,
} from './outcome-steward-adapter.js';
export type {
  DefaultOutcomeStewardAdapterOptions,
} from './outcome-steward-adapter.js';

export {
  SOURCE_STATE,
  PASS_STATE,
  FAIL_STATE,
} from './types.js';
export type {
  SourceState,
  PassState,
  FailState,
  ProductionTarget,
  PlaywrightAdapter,
  PlaywrightRunPlan,
  PlaywrightRunResult,
  PlaywrightRunStatus,
  PlaywrightSpecResult,
  OutcomeStewardAdapter,
  OutcomeStewardCheck,
  OutcomeStewardCheckOptions,
  RollbackRecommendation,
  RollbackSeverity,
  SpecResolution,
  SpecStrategy,
  StateTransitionOutcome,
  ValidateInProductionConfig,
  ValidateInProductionResult,
} from './types.js';

/**
 * @chiefaia/apprentice-retrainer — public API.
 *
 * Phase 4 of the Apprentice campaign. Cron-driven orchestrator that runs
 * corpus → train → eval → register → promote-canary end-to-end with auto-
 * eval-gate; operator-prompts for full canary → production.
 */

export { ApprenticeRetrainer } from './retrainer.js';
export { StateStore } from './state-store.js';
export { acquireLock } from './lockfile.js';
export type { LockHandle, LockfileConfig } from './lockfile.js';
export { DigestWriter, renderBody } from './digest.js';
export { resolveConfig, expandHome } from './config.js';
export { DefaultFsAccess } from './fs-access.js';
export {
  preTrainDecision,
  postTrainDecision,
  shouldRetrainGivenDelta
} from './decision.js';
export type { Decision, PostTrainDecision, DecisionInput, PostTrainDecisionInput } from './decision.js';
export {
  appendAuditRow,
  averageQualityFromHistogram,
  decideQualityGate
} from './quality-gate.js';
export type {
  AuditAppendOptions,
  CorpusManifestLike,
  QualityGateDecision,
  QualityGateInput
} from './quality-gate.js';

export { createProductionRetrainer } from './production-wiring.js';
export type { ProductionWiringOverrides } from './production-wiring.js';

export type {
  ApprenticeRetrainerConfig,
  CorpusAggregateResult,
  CorpusAggregator,
  EvalAdapterReport,
  EvalHarness,
  EvalReport,
  EvalRequest,
  FsAccess,
  LastErrorRecord,
  LastTrainRecord,
  RegistryEntry,
  ResolvedRetrainerConfig,
  RetrainerHistoryEntry,
  RetrainerOutcome,
  RetrainerRunResult,
  RetrainerStateFile,
  Trainer,
  TrainerRequest,
  TrainerResult
} from './types.js';

export {
  RetrainerError,
  LockfileError,
  CorpusFailedError,
  TrainingFailedError,
  EvalFailedError,
  RegisterFailedError,
  PromotionFailedError,
  StateCorruptError,
  NoCanaryActiveError
} from './types.js';

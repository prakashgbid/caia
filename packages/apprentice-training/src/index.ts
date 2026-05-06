/**
 * `@chiefaia/apprentice-training` — public barrel.
 *
 * This is the only file consumers should import from. Internal modules
 * are not part of the API surface; the trainer is the entry point.
 */

export { ApprenticeTrainer } from './trainer.js';
export type { TrainOptions } from './trainer.js';
export { resolveConfig, validateResolvedConfig, DEFAULT_LORA_CONFIG, expandHome } from './config.js';
export { defaultFsAccess } from './fs-access.js';
export { defaultSubprocessRunner } from './subprocess-runner.js';
export { buildMlxLoraArgs, renderLoraConfigYaml } from './mlx-args-builder.js';
export type { MlxLoraInvocation } from './mlx-args-builder.js';
export { splitSamples } from './splitter.js';
export { writeSplitJsonl, samplesToJsonl } from './jsonl-formatter.js';
export { ManifestReader } from './manifest-reader.js';
export { Preflight, REQUIRED_MLX_FLAGS } from './preflight.js';
export { Postflight } from './postflight.js';
export { MetadataWriter, configSha256 } from './metadata-writer.js';
export type {
  ApprenticeTrainingConfig,
  ResolvedTrainingConfig,
  LoraConfig,
  TrainResult,
  TrainingMetadata,
  EvalAdapterDescriptor,
  EvalAdapterReport,
  EvalHarness,
  EvalReport,
  EvalRequest,
  ChatMessage,
  CorpusSample,
  CorpusManifestRead,
  FsAccess,
  SplitResult,
  SubprocessArgs,
  SubprocessResult,
  SubprocessRunner
} from './types.js';
export {
  TrainingError,
  InsufficientCorpusError,
  PreflightError,
  MlxLmVersionIncompatibleError,
  MlxLoraSubprocessError,
  AdapterNotProducedError,
  CloudGpuBudgetError
} from './types.js';

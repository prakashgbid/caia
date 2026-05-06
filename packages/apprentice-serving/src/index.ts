/**
 * @chiefaia/apprentice-serving — public API.
 *
 * Phase 3 of the Apprentice campaign. Loads adapters produced by
 * @chiefaia/apprentice-training (Phase 2) into Ollama, tracks lifecycle
 * state in a persisted JSON registry, and writes a canary-routing config
 * read at inference time by downstream agents.
 */

export { ApprenticeServing } from './serving.js';
export { AdapterRegistry } from './adapter-registry.js';
export { CanaryRouter, canaryBucket, writeCanaryRouting } from './canary-router.js';
export { readAdapterArtifacts, extractEvalSummary } from './metadata-reader.js';
export { SubprocessOllamaClient, DefaultSubprocessExecutor, parseListOutput } from './ollama-client.js';
export type { OllamaClientConfig, SubprocessExecutor, SubprocessExecutorArgs, SubprocessExecutorResult } from './ollama-client.js';
export type { AdapterArtifacts } from './metadata-reader.js';
export { DefaultFsAccess } from './fs-access.js';
export { resolveServingConfig, resolveAdapterRegistryConfig, resolveCanaryRouterConfig, baseShortName, expandHome } from './config.js';

// Types + errors
export type {
  ApprenticeServingConfig,
  AdapterRegistryConfig,
  CanaryRouterConfig,
  CanaryRoutingCanaryEntry,
  CanaryRoutingConfigFile,
  CanaryRoutingProductionEntry,
  EvalReportRead,
  EvalSummary,
  FsAccess,
  OllamaClient,
  OllamaCreateArgs,
  RegistryEntry,
  RegistryFile,
  RegistryHistoryEntry,
  RegistryStatus,
  ResolvedAdapterRegistryConfig,
  ResolvedCanaryRouterConfig,
  ResolvedServingConfig,
  RoutingDecision,
  TrainingMetadataRead
} from './types.js';

export {
  ServingError,
  AdapterNotFoundError,
  MetadataMalformedError,
  RegistryInvariantError,
  RegistryStateMismatchError,
  RegistryCorruptError,
  OllamaNotInstalledError,
  OllamaCreateError,
  OllamaRemoveError,
  OllamaInspectError,
  RollbackTargetInvalidError,
  CanaryPercentOutOfRangeError
} from './types.js';

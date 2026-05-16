// LLM-assisted path
export { scaffoldFromLlm } from './llm.js';
export type { ScaffoldFromLlmOptions } from './llm.js';
export {
  parseScaffolderSpec,
  validateScaffolderSpec,
  extractYamlBlock,
  specToYaml,
  SchemaError,
} from './schema.js';
export { gatherContext, deriveKeywords } from './context.js';
export type { GatheredContext, GatherOptions } from './context.js';
export {
  resolveProvider,
  makeClaudeProvider,
  makeLocalProvider,
  makeFixtureProvider,
} from './providers.js';
export type { ProviderResolveOpts } from './providers.js';
export type {
  LooseBacklogItem,
  Machine,
  ScaffolderChainSpec,
  ScaffolderPhase,
  ScaffolderSuccessCriteria,
  LlmScaffoldResult,
  LlmProvider,
  RawLlmScaffold,
} from './types.js';

// Templated path (deterministic, zero-LLM)
export {
  scaffoldFromBacklogItem,
  buildChainSpec,
  buildInitialState,
  renderPhasesYaml,
  renderRunnerScript,
  validateBacklogItem,
  chainPaths,
  deriveLogSlug,
} from './templated.js';
export type {
  BacklogItem,
  BacklogSuccessCriteria,
  ScaffoldOptions,
  ScaffoldResult,
  RunnerScriptInputs,
} from './templated.js';
export { listPending, nextAvailable, parseBacklog } from './backlog.js';
export type { BacklogIndex, BacklogIndexEntry } from './backlog.js';

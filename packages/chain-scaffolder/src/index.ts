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

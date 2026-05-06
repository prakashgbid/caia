/**
 * @chiefaia/system-prompt-block — public surface.
 *
 * Generates the deterministic ≤1K-token CAIA primer block to be
 * prepended to every spawned agent's system prompt. Option E shape per
 * agent/memory/agent_architecture_shape_2026-05-06.md.
 */

export { generateCaiaPrimer } from './generate.js';
export type {
  FsReader,
  GenerateCaiaPrimerOptions,
  PrimerResult
} from './types.js';
export { defaultFsReader } from './types.js';
export {
  DEFAULT_ARCHITECTURE_DOC_PATH,
  DEFAULT_DOD_SOURCE_PATH,
  DEFAULT_MEMORY_INDEX_PATH,
  DEFAULT_TOKEN_BUDGET
} from './defaults.js';
export { estimateTokens } from './token-estimate.js';
export {
  extractArchitectureToc,
  extractDoDStages,
  extractStandingInstructions
} from './extract.js';
export { renderPrimer } from './render.js';

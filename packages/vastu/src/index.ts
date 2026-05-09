/**
 * @chiefaia/vastu — public API barrel.
 *
 * Phase 1 surface (T4.8): types + config + pipeline orchestrator + stage stubs.
 * Stages are stub implementations; subsequent phases fill them in.
 *
 * NOT published. Private workspace package per Option E
 * (`agent_architecture_shape_2026-05-06.md`).
 */

export { runVastuPipeline } from './pipeline.js';
export type { RunVastuPipelineOptions } from './pipeline.js';

export { textToDoc, TextToDocLLMError } from './text-to-doc.js';
export type { TextToDocOptions, RouteFn } from './text-to-doc.js';

export { extractHeuristics } from './heuristics.js';
export type { ExtractedHints } from './heuristics.js';

export {
  FormalDocSchema,
  FormalDocSectionSchema,
  FormalDocOriginSchema,
  FormalDocMinimalSchema
} from './formal-doc-schema.js';

export { docToFigma, computeChecksum } from './doc-to-figma.js';
export type { DocToFigmaOptions } from './doc-to-figma.js';

export { figmaToScaffold } from './figma-to-scaffold.js';
export type { FigmaToScaffoldOptions } from './figma-to-scaffold.js';

export {
  defaultCaiaVastuConfig,
  buildVastuConfig,
  VastuConfigSchema,
  BrandVoiceSchema,
  PaletteSchema,
  LibraryUrlsConfigSchema,
  ComponentMappingEntrySchema
} from './config.js';
export type {
  VastuConfig,
  BrandVoice,
  Palette,
  LibraryUrlsConfig,
  ComponentMappingEntry
} from './config.js';

export { ComponentMapper } from './component-map.js';
export type { ComponentMapperOpts } from './component-map.js';

export { stackFrames, totalHeight } from './layout.js';

export {
  ApprovalStatus,
  ApprovalEntrySchema,
  ApprovalsRegistrySchema,
  readApprovals,
  verifyApprovals
} from './approvals.js';
export type { ApprovalEntry, ApprovalsRegistry, ApprovalVerdict } from './approvals.js';

export {
  generateFigmaDesignViaMcp,
  __setMockMcpClient,
  __resetMcpCallCount,
  __getMcpCallCount
} from './mcp-client.js';
export type { McpWriteResult } from './mcp-client.js';

export type {
  FormalDoc,
  FormalDocSection,
  FigmaSpec,
  FrameNode,
  ComponentRef,
  LibraryUrls,
  Scaffold,
  ScaffoldFile,
  VastuInput,
  VastuResult
} from './types.js';

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

export { textToDoc } from './text-to-doc.js';
export type { TextToDocOptions } from './text-to-doc.js';

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

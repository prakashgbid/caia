/**
 * `@chiefaia/atlas-mapper` — public entry point.
 *
 * The pure-logic core of Atlas (CAIA Step 6). Operates on the
 * canonical `RenderableDesign` shape from step-5 and produces:
 *
 *   - stable, AST-shape-fingerprint DOM-IDs that survive style/copy/
 *     asset changes but flip on structural changes
 *   - a flat DOM-ID map for O(1) lookup
 *   - a bidirectional ticket ↔ DOM-ID mapper
 *   - a per-DOM-ID structural diff between two design versions
 *
 * No UI, no network, no LLM calls.
 *
 * Anchor docs:
 *   - research/atlas_module_spec_2026.md §2 (DOM-like uniqueness)
 *   - research/atlas_module_spec_2026.md §3 (bidirectional selection)
 *   - research/atlas_module_spec_2026.md §7 (multi-source adapter contract)
 *   - research/step5_design_ingest_spec_2026.md §1 (RenderableDesign)
 */

export { assignStableDomIds } from './assign-stable-dom-ids.js';

export { buildDomIdMap } from './dom-id-map.js';
export type { DomIdEntry, DomIdMap } from './dom-id-map.js';

export { buildMapper } from './mapper.js';
export type { Mapper } from './mapper.js';

export { diff, diffDesigns, diffMaps } from './diff.js';
export type { DesignDiff, DiffReason, ModifiedEntry } from './diff.js';

export { composeDomId, nodeFingerprint, slugifyTag } from './fingerprint.js';

export { parseJsxToRenderableDesign } from './parse-jsx.js';
export type { ParseJsxFileInput, ParseJsxInput } from './parse-jsx.js';

export { AtlasMapperError } from './errors.js';
export type { AtlasMapperErrorCode } from './errors.js';

export type {
  NodeLevel,
  NodeRole,
  RenderableAsset,
  RenderableComponentTree,
  RenderableCopy,
  RenderableDesign,
  RenderableDesignTokens,
  RenderableInteractivity,
  RenderableNode,
  RenderableRoute,
  RenderableSharedComponent,
} from './renderable-design.js';

export type { Ticket, TicketNode } from './ticket-tree.js';

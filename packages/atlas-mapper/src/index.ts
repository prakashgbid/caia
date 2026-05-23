/**
 * `@chiefaia/atlas-mapper` — public entry point.
 *
 * The core algorithm package for Atlas (CAIA Step 6). Pure-logic,
 * referentially-transparent functions over the canonical
 * `RenderableDesign` shape from step-5:
 *
 *   - `buildDomIdMap`  — flatten a design's component trees into a
 *                        deterministic `{ domId, parentDomId, role,
 *                        tag, bounds, attrs, … }` table.
 *   - `buildMapper`    — combine a DOM-ID map + a hierarchical ticket
 *                        tree into the four bidirectional query APIs
 *                        atlas's interaction layer needs.
 *   - `diffDesigns`    — structural v1↔v2 diff at the DOM-ID level
 *                        with structured `DiffReason` codes.
 *   - `diffMaps`       — lower-level diff for callers that already
 *                        have the maps materialised.
 *
 * Anchor docs:
 *   - research/atlas_module_spec_2026.md §2 (DOM-like uniqueness model)
 *   - research/atlas_module_spec_2026.md §7 (RenderableDesign contract)
 *   - research/step5_design_ingest_spec_2026.md §1 (canonical shape)
 */

export { buildDomIdMap } from './dom-id-map.js';
export type { DomIdEntry, DomIdMap } from './dom-id-map.js';

export { buildMapper } from './mapper.js';
export type { Mapper } from './mapper.js';

export { diffDesigns, diffMaps } from './diff.js';
export type { DesignDiff, DiffReason, ModifiedEntry } from './diff.js';

export { AtlasMapperError } from './errors.js';
export type { AtlasMapperErrorCode } from './errors.js';

export type {
  RenderableDesign,
  RenderableNode,
  RenderableComponentTree,
  RenderableRoute,
  RenderableCopy,
  RenderableAsset,
  RenderableDesignTokens,
  NodeRole,
  NodeLevel,
} from './renderable-design.js';

export type { Ticket, TicketNode } from './ticket-tree.js';

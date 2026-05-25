/**
 * DOM-ID helpers for `@caia/design-ingest`.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §6
 *
 * Design choice: the heavy lifting lives in `@chiefaia/atlas-mapper`.
 * This package re-exports those entry points so adapter authors can
 * import them through a single `@caia/design-ingest` import. We also
 * provide one convenience helper (`finalizeDomIds`) which is the
 * idiom every adapter should run on its emitted `RenderableDesign`
 * just before returning it from `parse()`.
 *
 * Adapters MAY pre-fill `domId` on nodes when they have a stable
 * source-derived ID (the CD ZIP adapter does, derived from JSX
 * component / `<section id>` / first class / heading text). Atlas-
 * mapper's `assignStableDomIds` preserves adapter-supplied IDs
 * verbatim and only derives IDs for nodes missing one.
 */

import {
  assignStableDomIds,
  buildDomIdMap,
  buildMapper,
  composeDomId,
  diffDesigns,
  nodeFingerprint,
  slugifyTag,
  AtlasMapperError,
} from '@chiefaia/atlas-mapper';
import type {
  DomIdEntry,
  DomIdMap,
  Mapper,
  RenderableDesign,
  AtlasMapperErrorCode,
  DesignDiff as AtlasDesignDiff,
} from '@chiefaia/atlas-mapper';

// Re-export the mapper surface so adapters can stay one-import-only.
export {
  assignStableDomIds,
  buildDomIdMap,
  buildMapper,
  composeDomId,
  diffDesigns,
  nodeFingerprint,
  slugifyTag,
  AtlasMapperError,
};
export type {
  DomIdEntry,
  DomIdMap,
  Mapper,
  AtlasMapperErrorCode,
  AtlasDesignDiff,
};

/**
 * One-shot helper — adapters call this on the `RenderableDesign` they
 * built, just before returning from `parse()`. It runs
 * `assignStableDomIds` (which deep-clones the design + fills missing
 * `domId`s + detects cycles + detects duplicate IDs) and returns the
 * finalised design.
 *
 * If the design has any structural issue, atlas-mapper throws
 * `AtlasMapperError` with one of the codes:
 *   - `cycle_detected`
 *   - `duplicate_dom_id`
 *   - `unknown_component_tree`
 *   - `invalid_renderable_design`
 *
 * Adapters should let those propagate — the Ingestor will translate
 * them into `failed` ux_upload status.
 */
export function finalizeDomIds(design: RenderableDesign): RenderableDesign {
  return assignStableDomIds(design);
}

/**
 * Convenience — derive a "sub-tree segment" of a DOM ID per the spec's
 * `<levelPrefix>-<semanticSlug>[-<index>]` shape.
 *
 * Atlas-mapper's `composeDomId(parent, segment)` joins them with `>`
 * (`page-home>section-hero>widget-cta-button`). This helper just
 * formats the segment portion in a consistent, kebabbed way so
 * adapters don't reinvent the slug rules.
 */
export function buildSegment(
  level: 'page' | 'section' | 'widget' | 'leaf' | 'shared',
  semanticSlug: string,
  index?: number,
): string {
  const slug = slugifyTag(semanticSlug);
  const base = `${level}-${slug}`;
  return index === undefined ? base : `${base}-${index}`;
}

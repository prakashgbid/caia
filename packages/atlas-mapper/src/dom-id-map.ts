/**
 * DOM-ID generation — the core of atlas-mapper.
 *
 * Walks every `componentTree` in a `RenderableDesign` and emits a flat
 * map of `{ domId, parentDomId, role, tag, bounds, attrs }` entries.
 *
 * # Determinism contract (atlas spec §2.3)
 *
 * The same `RenderableDesign` MUST produce the same `DomIdMap`. The
 * fingerprint algorithm uses only structural inputs:
 *
 *     fingerprint = `${parent-domId}>${tag}:${role}:${sibling-position}`
 *
 * — and explicit adapter-supplied IDs always win over derived ones.
 * This means:
 *
 * - Style / className / inline-style changes do NOT shift the ID.
 * - Inner text / copy changes do NOT shift the ID.
 * - Asset swaps (image href, alt text) do NOT shift the ID.
 * - Structural moves (reparent, reorder) DO shift the ID.
 *
 * Adapter-supplied `node.domId` always takes precedence. The CD-ZIP
 * adapter uses the Babel transform to inject IDs derived from the
 * ux-to-tickets taxonomy (`PG-home`, `WD-home-hero-rotator`, …); the
 * Figma adapter uses Figma's stable node ids. atlas-mapper just
 * accepts what they emit.
 *
 * # Failure modes
 *
 * - `cycle_detected` — the same `domId` (adapter-supplied or derived)
 *   appears on the visit path twice. We refuse rather than infinite-
 *   loop. Caller fixes the input.
 * - `duplicate_dom_id` — two distinct nodes resolve to the same
 *   `domId`. This is the §7.4 "selector collision" the adapter is
 *   supposed to fail at build time — but if it slips through,
 *   atlas-mapper catches it on first read.
 * - `unknown_component_tree` — a `routes[i].componentTreeId` doesn't
 *   resolve in `componentTrees`. Caller must fix the manifest.
 */

import { AtlasMapperError } from './errors.js';
import type { RenderableDesign, RenderableNode } from './renderable-design.js';

/**
 * A single entry in the flat DOM-ID map. This is what atlas's iframe
 * registry consumes — `selector`-resolution lives elsewhere, but the
 * structured fields here are everything atlas-mapper itself needs to
 * answer queries and diff.
 */
export interface DomIdEntry {
  /** Stable DOM-ID — primary key. */
  domId: string;

  /** Parent's DOM-ID; null for tree roots. */
  parentDomId: string | null;

  /**
   * Path from root, inclusive of `domId`. Useful for ancestor walks
   * without re-traversing the tree. e.g. `['page-home',
   * 'page-home>section-hero', 'page-home>section-hero>cta-0']`.
   */
  ancestry: string[];

  /** Role tag, e.g. `section`, `widget`, `leaf`. */
  role: RenderableNode['role'];

  /** HTML tag or component name. */
  tag: string;

  /** Sibling position under the parent (0-indexed). */
  position: number;

  /** Optional bounds — passed through from the input. */
  bounds: { x: number; y: number; w: number; h: number } | null;

  /** Verbatim props bag. Cloned shallowly so callers can't mutate input. */
  attrs: Record<string, unknown>;

  /** Resolved style block, if the adapter computed one. */
  resolvedStyle: Record<string, unknown> | null;

  /** FK references — passed through verbatim. */
  copyRefs: string[];
  assetRefs: string[];
  interactivityRefs: string[];

  /** Shared-component reference. */
  sharedRef: string | null;

  /**
   * Which `componentTrees` key this entry came from. Routes can share
   * trees (e.g. blog templates), so a `(treeId, domId)` pair is the
   * truly-unique key in the broader system — but within one map,
   * `domId` alone is unique (otherwise we'd throw `duplicate_dom_id`).
   */
  componentTreeId: string;

  /** Provenance — passed through. */
  provenance: Record<string, unknown> | null;
}

/**
 * The output of `buildDomIdMap`. `entries` is sorted in deterministic
 * depth-first pre-order so equality checks and snapshots are stable.
 * `byId` is a lookup index for O(1) queries.
 */
export interface DomIdMap {
  designVersionId: string;
  entries: DomIdEntry[];
  byId: Map<string, DomIdEntry>;
}

/* ────────────────────────────────────────────────────────────────── */
/* helpers                                                             */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Slugify a tag or component name into the fingerprint-safe form used
 * when the adapter hasn't supplied an explicit `domId`.
 *
 * - `<HomeHeroSlider>` → `home-hero-slider`
 * - `section` → `section`
 * - `div` → `div`
 * - empty / undefined → `unknown`
 */
function slugifyTag(tag: string): string {
  if (!tag) return 'unknown';
  // Strip angle brackets (component names sometimes arrive as
  // `<HomeHero>` from JSX-stringification).
  const stripped = tag.replace(/^<|>$/g, '');
  // PascalCase / camelCase → kebab-case.
  const kebabed = stripped
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
  // Drop any remaining non-alphanumerics.
  return kebabed.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'unknown';
}

/**
 * Derive the deterministic DOM-ID for a node when the adapter hasn't
 * supplied one. Pure function of structural inputs only — style /
 * copy / asset changes can't affect the result.
 *
 * Algorithm:
 *
 *   id = parentDomId
 *        + '>' + (slugified tag) + ':' + role + ':' + position
 *
 * For roots (no parent), the parent prefix is omitted and the result
 * is `${tag-slug}:${role}:${position}` — which then becomes the
 * ancestor of everything below it.
 *
 * The role + position are intentionally part of the ID: two `<div>`s
 * with the same tag at the same level under the same parent ARE
 * structurally distinct, and a sibling reorder is structural change
 * per spec §2.3.
 */
function deriveDomId(
  tag: string,
  role: RenderableNode['role'],
  position: number,
  parentDomId: string | null,
): string {
  const segment = `${slugifyTag(tag)}:${role}:${position}`;
  return parentDomId === null ? segment : `${parentDomId}>${segment}`;
}

/**
 * Resolve the DOM-ID for a node, preferring the adapter-supplied
 * `node.domId` when present. Trimmed and validated to be non-empty.
 */
function resolveDomId(
  node: RenderableNode,
  position: number,
  parentDomId: string | null,
): string {
  const supplied = typeof node.domId === 'string' ? node.domId.trim() : '';
  if (supplied.length > 0) return supplied;
  return deriveDomId(node.tag, node.role, position, parentDomId);
}

/**
 * Shallow-clone a props bag so the emitted entry doesn't share
 * references with the input. atlas-mapper is a pure function from the
 * caller's point of view, so mutations on its output can't surprise
 * them.
 */
function cloneRecord<T extends Record<string, unknown> | undefined>(rec: T): Record<string, unknown> {
  if (!rec) return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(rec)) out[k] = (rec as Record<string, unknown>)[k];
  return out;
}

/* ────────────────────────────────────────────────────────────────── */
/* the walk                                                            */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Recursive walker. Tracks:
 *
 * - `visitedOnPath` — the set of DOM-IDs currently on the call stack,
 *   used for cycle detection.
 * - `byId` — the cumulative map, used for duplicate detection.
 * - `entries` — the output array, pushed in depth-first pre-order.
 *
 * `position` is the sibling index of this node under its parent.
 */
function walk(
  node: RenderableNode,
  position: number,
  parentDomId: string | null,
  ancestry: string[],
  componentTreeId: string,
  visitedOnPath: Set<string>,
  byId: Map<string, DomIdEntry>,
  entries: DomIdEntry[],
): void {
  const domId = resolveDomId(node, position, parentDomId);

  if (visitedOnPath.has(domId)) {
    throw new AtlasMapperError(
      'cycle_detected',
      `DOM-ID cycle detected: '${domId}' already on the visit path`,
      { domId, path: [...visitedOnPath] },
    );
  }
  if (byId.has(domId)) {
    throw new AtlasMapperError(
      'duplicate_dom_id',
      `Duplicate DOM-ID '${domId}' — two distinct nodes resolve to the same id`,
      { domId, componentTreeId },
    );
  }

  const nextAncestry = [...ancestry, domId];

  const entry: DomIdEntry = {
    domId,
    parentDomId,
    ancestry: nextAncestry,
    role: node.role,
    tag: node.tag,
    position,
    bounds: node.bounds ? { ...node.bounds } : null,
    attrs: cloneRecord(node.attrs as Record<string, unknown> | undefined),
    resolvedStyle: node.resolvedStyle
      ? cloneRecord(node.resolvedStyle as Record<string, unknown>)
      : null,
    copyRefs: Array.isArray(node.copyRefs) ? [...node.copyRefs] : [],
    assetRefs: Array.isArray(node.assetRefs) ? [...node.assetRefs] : [],
    interactivityRefs: Array.isArray(node.interactivityRefs) ? [...node.interactivityRefs] : [],
    sharedRef: typeof node.sharedRef === 'string' ? node.sharedRef : null,
    componentTreeId,
    provenance: node.provenance
      ? cloneRecord(node.provenance as Record<string, unknown>)
      : null,
  };

  byId.set(domId, entry);
  entries.push(entry);

  // Recurse children. We add `domId` to the visit path BEFORE descending
  // and remove it AFTER — this gives correct cycle detection without
  // false positives across sibling sub-trees.
  visitedOnPath.add(domId);
  const children = Array.isArray(node.children) ? node.children : [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    walk(child, i, domId, nextAncestry, componentTreeId, visitedOnPath, byId, entries);
  }
  visitedOnPath.delete(domId);
}

/* ────────────────────────────────────────────────────────────────── */
/* public entry                                                        */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Build the flat DOM-ID map for a `RenderableDesign`.
 *
 * Traversal order:
 *
 * 1. Sort routes by `path` (lexicographic) for determinism. Note: the
 *    diff algorithm sorts its output too, so input route order doesn't
 *    affect downstream — but sorting here means snapshot tests don't
 *    care about adapter route-emission order either.
 * 2. For each route, look up its `componentTreeId` and walk that tree
 *    if we haven't walked it yet (multiple routes can share one tree —
 *    spec §1.2 — so we de-dupe by tree id).
 * 3. After all route-referenced trees are walked, walk any
 *    `sharedComponents` that have a `node`. These get their own
 *    componentTreeId of the form `shared:<id>` so they don't collide
 *    with route trees.
 *
 * @param design the canonical RenderableDesign payload
 * @returns the flat map + index
 * @throws AtlasMapperError on cycles, duplicates, or missing tree refs
 */
export function buildDomIdMap(design: RenderableDesign): DomIdMap {
  if (!design || typeof design !== 'object') {
    throw new AtlasMapperError('invalid_renderable_design', 'design must be an object', {});
  }
  if (typeof design.designVersionId !== 'string' || design.designVersionId.length === 0) {
    throw new AtlasMapperError(
      'invalid_renderable_design',
      'design.designVersionId must be a non-empty string',
      {},
    );
  }
  if (!design.componentTrees || typeof design.componentTrees !== 'object') {
    throw new AtlasMapperError(
      'invalid_renderable_design',
      'design.componentTrees must be an object',
      {},
    );
  }
  if (!Array.isArray(design.routes)) {
    throw new AtlasMapperError(
      'invalid_renderable_design',
      'design.routes must be an array',
      {},
    );
  }

  const byId: Map<string, DomIdEntry> = new Map();
  const entries: DomIdEntry[] = [];
  const walkedTrees = new Set<string>();

  // Deterministic route order — lexicographic by path. Then de-dupe
  // by component-tree id so a tree shared across N routes is walked
  // exactly once.
  const routes = [...design.routes].sort((a, b) => {
    const ap = String(a.path ?? '');
    const bp = String(b.path ?? '');
    return ap < bp ? -1 : ap > bp ? 1 : 0;
  });

  for (const route of routes) {
    const treeId = route.componentTreeId;
    if (typeof treeId !== 'string' || treeId.length === 0) {
      throw new AtlasMapperError(
        'invalid_renderable_design',
        `route '${route.path}' has no componentTreeId`,
        { route: route.path },
      );
    }
    if (walkedTrees.has(treeId)) continue;
    const tree = design.componentTrees[treeId];
    if (!tree || !tree.node) {
      throw new AtlasMapperError(
        'unknown_component_tree',
        `route '${route.path}' references unknown componentTreeId '${treeId}'`,
        { route: route.path, componentTreeId: treeId },
      );
    }
    walk(tree.node, 0, null, [], treeId, new Set<string>(), byId, entries);
    walkedTrees.add(treeId);
  }

  // Also walk any componentTrees not referenced by routes — adapters
  // can emit trees without route bindings (e.g. shared component
  // libraries). Deterministic order: sorted by tree id.
  const allTreeIds = Object.keys(design.componentTrees).sort();
  for (const treeId of allTreeIds) {
    if (walkedTrees.has(treeId)) continue;
    const tree = design.componentTrees[treeId];
    if (!tree || !tree.node) continue;
    walk(tree.node, 0, null, [], treeId, new Set<string>(), byId, entries);
    walkedTrees.add(treeId);
  }

  // Walk shared components — they live outside the route graph but
  // still need DOM-IDs assigned. Deterministic order by `id`.
  const shared = Array.isArray(design.sharedComponents)
    ? [...design.sharedComponents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    : [];
  for (const sc of shared) {
    if (!sc || !sc.node) continue;
    const treeId = `shared:${sc.id}`;
    if (walkedTrees.has(treeId)) continue;
    walk(sc.node, 0, null, [], treeId, new Set<string>(), byId, entries);
    walkedTrees.add(treeId);
  }

  return {
    designVersionId: design.designVersionId,
    entries,
    byId,
  };
}

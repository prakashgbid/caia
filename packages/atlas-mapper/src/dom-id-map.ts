/**
 * Flat DOM-ID map — the read-side projection over a `RenderableDesign`.
 *
 * `assignStableDomIds` is the assign-side (mutates a tree, assigning
 * `domId`s to nodes that lack them). `buildDomIdMap` is the read-side:
 * given a tree (with or without pre-assigned IDs), it returns a flat
 * lookup table of `DomIdEntry` records plus an index `byId`.
 *
 * Callers normally do:
 *
 *     const stabilised = assignStableDomIds(rd);
 *     const map = buildDomIdMap(stabilised);
 *
 * but `buildDomIdMap` also accepts a tree whose IDs are already
 * assigned (saves a clone). When an `domId` is missing it derives one
 * via the same fingerprint algorithm.
 *
 * # Failure modes
 *
 * - `cycle_detected`     — same DOM-ID on the visit path twice.
 * - `duplicate_dom_id`   — two distinct nodes resolve to the same id.
 * - `unknown_component_tree` — route → tree id mismatch.
 * - `invalid_renderable_design` — top-level shape broken.
 */

import { AtlasMapperError } from './errors.js';
import { composeDomId, nodeFingerprint } from './fingerprint.js';
import type {
  RenderableDesign,
  RenderableNode,
  NodeRole,
} from './renderable-design.js';

/**
 * One row in the flat DOM-ID map.
 *
 * `ancestry` is inclusive of `domId` itself — i.e. the path from the
 * tree root down to and including this node. Useful for ancestor
 * walks without re-traversing the tree (see `mapper.ts`'s
 * `nearestEnclosingTicket` and `descendantTickets`).
 */
export interface DomIdEntry {
  /** Stable DOM-ID — primary key. */
  domId: string;

  /** Parent DOM-ID; null for component-tree roots. */
  parentDomId: string | null;

  /** Path from root, inclusive of `domId`. */
  ancestry: string[];

  /** Role tag — `section`, `widget`, `leaf`, etc. */
  role: NodeRole;

  /** HTML tag or component name. */
  tag: string;

  /** Sibling position under the parent (0-indexed). */
  position: number;

  /** Optional bounds — passed through from the input. */
  bounds: { x: number; y: number; w: number; h: number } | null;

  /** Verbatim props bag. Shallow-cloned so callers can't mutate input. */
  attrs: Record<string, unknown>;

  /** Resolved style block, if the adapter computed one. */
  resolvedStyle: Record<string, unknown> | null;

  /** FK references — passed through verbatim (shallow-cloned). */
  copyRefs: string[];
  assetRefs: string[];
  interactivityRefs: string[];

  /** Shared-component reference. */
  sharedRef: string | null;

  /**
   * Which `componentTrees` key this entry came from. Routes can share
   * trees (e.g. blog templates), so a `(treeId, domId)` pair is the
   * true unique key in the broader system — but within one map,
   * `domId` alone is unique (otherwise we throw `duplicate_dom_id`).
   *
   * Shared components use the synthetic `shared:<id>` tree id.
   */
  componentTreeId: string;

  /** Provenance — passed through (shallow-cloned). */
  provenance: Record<string, unknown> | null;
}

/**
 * The output of `buildDomIdMap`. `entries` is in depth-first pre-order
 * (across trees sorted by id) so snapshot equality is stable. `byId`
 * is the O(1) index.
 */
export interface DomIdMap {
  designVersionId: string;
  entries: DomIdEntry[];
  byId: Map<string, DomIdEntry>;
}

/**
 * Resolve a node's DOM-ID, preferring an adapter-supplied value when
 * non-empty and otherwise deriving one from the fingerprint.
 */
function resolveDomId(
  node: RenderableNode,
  position: number,
  parentDomId: string | null,
): string {
  const supplied = typeof node.domId === 'string' ? node.domId.trim() : '';
  if (supplied.length > 0) return supplied;
  const segment = nodeFingerprint(node.tag, node.role, position);
  return composeDomId(parentDomId, segment);
}

/**
 * Shallow-clone a plain record so the entry doesn't share references
 * with the input tree. Frozen-input wouldn't be enough — callers can
 * still mutate the clone safely while the original stays intact.
 */
function shallowClone(rec: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!rec) return {};
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(rec)) out[k] = rec[k];
  return out;
}

/**
 * Depth-first walk. Pushes one `DomIdEntry` per node into `entries`
 * and indexes by domId in `byId`. Cycle + duplicate detection live
 * here.
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
    attrs: shallowClone(node.attrs),
    resolvedStyle: node.resolvedStyle ? shallowClone(node.resolvedStyle) : null,
    copyRefs: Array.isArray(node.copyRefs) ? [...node.copyRefs] : [],
    assetRefs: Array.isArray(node.assetRefs) ? [...node.assetRefs] : [],
    interactivityRefs: Array.isArray(node.interactivityRefs) ? [...node.interactivityRefs] : [],
    sharedRef: typeof node.sharedRef === 'string' ? node.sharedRef : null,
    componentTreeId,
    provenance: node.provenance ? shallowClone(node.provenance) : null,
  };

  byId.set(domId, entry);
  entries.push(entry);

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return;

  visitedOnPath.add(domId);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    walk(child, i, domId, nextAncestry, componentTreeId, visitedOnPath, byId, entries);
  }
  visitedOnPath.delete(domId);
}

/**
 * Build the flat DOM-ID map for a `RenderableDesign`.
 *
 * Traversal order matches `assignStableDomIds`:
 *
 *   1. routes sorted by `path` lex; each `componentTreeId` walked once
 *   2. any component trees not referenced by routes, in sorted key order
 *   3. shared components, sorted by `id`
 *
 * @throws AtlasMapperError on cycles, duplicates, or missing trees
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

  const byId = new Map<string, DomIdEntry>();
  const entries: DomIdEntry[] = [];
  const walkedTrees = new Set<string>();

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

  for (const treeId of Object.keys(design.componentTrees).sort()) {
    if (walkedTrees.has(treeId)) continue;
    const tree = design.componentTrees[treeId];
    if (!tree || !tree.node) continue;
    walk(tree.node, 0, null, [], treeId, new Set<string>(), byId, entries);
    walkedTrees.add(treeId);
  }

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

/**
 * `assignStableDomIds(renderableDesign)` — the public API spec'd in
 * the Atlas-mapper task brief.
 *
 * Walks every `componentTree` and `sharedComponents[].node` in a
 * `RenderableDesign` and assigns each node a stable `domId` derived
 * from its AST-shape fingerprint (see `fingerprint.ts`).
 *
 * # Behaviour
 *
 * - **Adapter-supplied IDs win.** If a node already has a non-empty
 *   `domId`, we keep it. CD-ZIP and Figma adapters supply IDs they
 *   derived from source; we don't second-guess them.
 * - **Missing IDs are derived.** Nodes without `domId` get one
 *   composed from the parent path + their own `nodeFingerprint`.
 * - **Pure / non-mutating.** The function deep-clones the input tree
 *   before assigning; the original `RenderableDesign` is unchanged.
 *   This matters because the parent shell often calls
 *   `assignStableDomIds` repeatedly during a session.
 * - **Deterministic.** Same input → byte-for-byte identical output.
 *   Tree iteration order is sorted (routes by `path`, shared
 *   components by `id`, tree-records by key) so adapter ordering can't
 *   leak into the result.
 *
 * # Failure modes
 *
 * - `cycle_detected`         — an adapter-supplied `domId` appears on
 *                              the same visit path twice.
 * - `duplicate_dom_id`       — two distinct nodes resolve to the same
 *                              `domId` (after assignment). This is the
 *                              §7.4 selector-collision the adapter is
 *                              supposed to fail at; we catch it here
 *                              as a backstop.
 * - `unknown_component_tree` — a route references a tree id that
 *                              doesn't exist in `componentTrees`.
 * - `invalid_renderable_design` — top-level shape is broken.
 */

import { AtlasMapperError } from './errors.js';
import { composeDomId, nodeFingerprint } from './fingerprint.js';
import type {
  RenderableComponentTree,
  RenderableDesign,
  RenderableNode,
  RenderableSharedComponent,
} from './renderable-design.js';

/**
 * Deep clone a `RenderableNode` subtree. We deliberately preserve all
 * fields (including adapter extras like `provenance`) — callers
 * round-trip the full §1 shape through this function and we should
 * not lose information.
 */
function cloneNode(node: RenderableNode): RenderableNode {
  const cloned: RenderableNode = {
    tag: node.tag,
    role: node.role,
  };
  if (node.domId !== undefined) cloned.domId = node.domId;
  if (node.level !== undefined) cloned.level = node.level;
  if (node.attrs !== undefined) cloned.attrs = { ...node.attrs };
  if (node.resolvedStyle !== undefined) cloned.resolvedStyle = { ...node.resolvedStyle };
  if (node.copyRefs !== undefined) cloned.copyRefs = [...node.copyRefs];
  if (node.assetRefs !== undefined) cloned.assetRefs = [...node.assetRefs];
  if (node.interactivityRefs !== undefined) cloned.interactivityRefs = [...node.interactivityRefs];
  if (node.sharedRef !== undefined) cloned.sharedRef = node.sharedRef;
  if (node.bounds !== undefined) cloned.bounds = { ...node.bounds };
  if (node.provenance !== undefined) cloned.provenance = { ...node.provenance };
  if (Array.isArray(node.children)) {
    cloned.children = node.children.map(cloneNode);
  }
  return cloned;
}

/**
 * Resolve a node's `domId` — trust the adapter's value when non-empty,
 * otherwise compose one from the structural fingerprint.
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
 * Recursive in-place assignment over an already-cloned subtree. Tracks
 * visit-path IDs for cycle detection and the global `seen` set for
 * duplicate detection. The `seen` set spans the entire design, not
 * just one tree — duplicates across trees would still violate the
 * spec §2.4 (unique `(designVersionId, domId)`).
 */
function assignWalk(
  node: RenderableNode,
  position: number,
  parentDomId: string | null,
  visitedOnPath: Set<string>,
  seen: Set<string>,
  componentTreeId: string,
): void {
  const domId = resolveDomId(node, position, parentDomId);

  if (visitedOnPath.has(domId)) {
    throw new AtlasMapperError(
      'cycle_detected',
      `DOM-ID cycle detected: '${domId}' already on the visit path`,
      { domId, componentTreeId, path: [...visitedOnPath] },
    );
  }
  if (seen.has(domId)) {
    throw new AtlasMapperError(
      'duplicate_dom_id',
      `Duplicate DOM-ID '${domId}' — two distinct nodes resolve to the same id`,
      { domId, componentTreeId },
    );
  }

  node.domId = domId;
  seen.add(domId);

  const children = Array.isArray(node.children) ? node.children : [];
  if (children.length === 0) return;

  visitedOnPath.add(domId);
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (!child) continue;
    assignWalk(child, i, domId, visitedOnPath, seen, componentTreeId);
  }
  visitedOnPath.delete(domId);
}

/**
 * Sort routes by `path` lexicographically. Pure helper so the public
 * API can defer the comparator name lookup.
 */
function sortRoutes<T extends { path?: string }>(routes: readonly T[]): T[] {
  return [...routes].sort((a, b) => {
    const ap = String(a.path ?? '');
    const bp = String(b.path ?? '');
    return ap < bp ? -1 : ap > bp ? 1 : 0;
  });
}

/**
 * Validate the top-level `RenderableDesign` shape. We accept whatever
 * extras the adapter passed but require the fields atlas-mapper
 * actually reads.
 */
function validateDesign(design: RenderableDesign): void {
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
}

/**
 * Assign stable DOM-IDs to every node in a `RenderableDesign`.
 *
 * Returns a NEW `RenderableDesign` — the input is not mutated. All
 * `componentTrees[].node` and `sharedComponents[].node` subtrees are
 * deep-cloned, then walked and assigned. Adapter-supplied IDs are
 * preserved verbatim; missing IDs are derived from
 * `parent>tag:role:position` fingerprints.
 *
 * The traversal order is:
 *
 *   1. routes sorted by `path` lex; each `componentTreeId` walked
 *      exactly once (multiple routes can share a tree)
 *   2. any component trees not referenced by routes, in sorted key
 *      order
 *   3. shared components, sorted by `id`
 *
 * Determinism follows from the sort.
 *
 * @throws AtlasMapperError on cycles, duplicates, missing trees, or
 *         broken top-level shape
 */
export function assignStableDomIds(design: RenderableDesign): RenderableDesign {
  validateDesign(design);

  // Deep-clone componentTrees + sharedComponents so we don't mutate input.
  const componentTrees: Record<string, RenderableComponentTree> = {};
  for (const key of Object.keys(design.componentTrees)) {
    const tree = design.componentTrees[key];
    if (!tree || !tree.node) continue;
    const clonedTree: RenderableComponentTree = { node: cloneNode(tree.node) };
    if (tree.rootDomId !== undefined) clonedTree.rootDomId = tree.rootDomId;
    componentTrees[key] = clonedTree;
  }

  const sharedComponents: RenderableSharedComponent[] | undefined = Array.isArray(
    design.sharedComponents,
  )
    ? design.sharedComponents.map((sc) => {
        const cloned: RenderableSharedComponent = {
          id: sc.id,
          node: cloneNode(sc.node),
        };
        if (sc.domIdPrefix !== undefined) cloned.domIdPrefix = sc.domIdPrefix;
        if (sc.usedByDomIds !== undefined) cloned.usedByDomIds = [...sc.usedByDomIds];
        return cloned;
      })
    : undefined;

  const seen = new Set<string>();
  const walkedTreeIds = new Set<string>();

  // Pass 1: walk trees referenced by routes (sorted by route path).
  for (const route of sortRoutes(design.routes)) {
    const treeId = route.componentTreeId;
    if (typeof treeId !== 'string' || treeId.length === 0) {
      throw new AtlasMapperError(
        'invalid_renderable_design',
        `route '${route.path}' has no componentTreeId`,
        { route: route.path },
      );
    }
    if (walkedTreeIds.has(treeId)) continue;
    const tree = componentTrees[treeId];
    if (!tree) {
      throw new AtlasMapperError(
        'unknown_component_tree',
        `route '${route.path}' references unknown componentTreeId '${treeId}'`,
        { route: route.path, componentTreeId: treeId },
      );
    }
    assignWalk(tree.node, 0, null, new Set<string>(), seen, treeId);
    walkedTreeIds.add(treeId);
  }

  // Pass 2: walk any trees not referenced by routes (sorted by key).
  for (const treeId of Object.keys(componentTrees).sort()) {
    if (walkedTreeIds.has(treeId)) continue;
    const tree = componentTrees[treeId];
    if (!tree) continue;
    assignWalk(tree.node, 0, null, new Set<string>(), seen, treeId);
    walkedTreeIds.add(treeId);
  }

  // Pass 3: walk shared components (sorted by id).
  if (sharedComponents) {
    const sortedShared = [...sharedComponents].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
    for (const sc of sortedShared) {
      const treeId = `shared:${sc.id}`;
      if (walkedTreeIds.has(treeId)) continue;
      assignWalk(sc.node, 0, null, new Set<string>(), seen, treeId);
      walkedTreeIds.add(treeId);
    }
  }

  // Assemble the output with all the adapter pass-through fields intact.
  const out: RenderableDesign = {
    designVersionId: design.designVersionId,
    routes: design.routes.map((r) => ({ ...r })),
    componentTrees,
  };
  if (design.source !== undefined) out.source = design.source;
  if (sharedComponents) out.sharedComponents = sharedComponents;
  if (design.copy !== undefined) out.copy = design.copy.map((c) => ({ ...c }));
  if (design.assets !== undefined) out.assets = design.assets.map((a) => ({ ...a }));
  if (design.interactivity !== undefined)
    out.interactivity = design.interactivity.map((i) => ({ ...i }));
  if (design.designTokens !== undefined) out.designTokens = { ...design.designTokens };
  if (design.sourceMetadata !== undefined) out.sourceMetadata = { ...design.sourceMetadata };
  if (design.site !== undefined) out.site = { ...design.site };
  if (design.rawSourceArtifacts !== undefined)
    out.rawSourceArtifacts = { ...design.rawSourceArtifacts };
  if (design.ingestDiagnostics !== undefined)
    out.ingestDiagnostics = { ...design.ingestDiagnostics };
  if (design.tenantId !== undefined) out.tenantId = design.tenantId;
  if (design.businessProposalId !== undefined) out.businessProposalId = design.businessProposalId;
  if (design.uploadedAt !== undefined) out.uploadedAt = design.uploadedAt;

  return out;
}

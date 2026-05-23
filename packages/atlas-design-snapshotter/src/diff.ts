/**
 * Structural diff between two `RenderableDesign` versions.
 *
 * Reference: research/step5_design_ingest_spec_2026.md §5.2.
 *
 * Pure, deterministic, synchronous. No LLM. No network. Three layers:
 *   1. Tree diff   — keyed on `Node.domId`. Stable DOM-IDs across versions
 *                    (Step 5 §6) mean a moved node shows up as `moved`,
 *                    not `add + remove`.
 *   2. Token diff  — set diff of `designTokens` keys + value diff of
 *                    intersecting keys.
 *   3. Flat-table diff — set diff over `copy[]`, `assets[]`,
 *                    `interactivity[]` keyed by `domId` or `path`.
 *
 * Output shape goes into `design_versions.diff_from_parent` JSONB.
 */

import type {
  RenderableDesign,
  RenderableNode,
  RenderableAsset,
  RenderableCopy,
  RenderableInteractivity,
  RenderableDesignTokens,
} from '@chiefaia/atlas-mapper';
import { canonicalJson } from './hash.js';

// ----- Output shape ------------------------------------------------------

export interface NodeMove {
  domId: string;
  fromParent: string | null;
  toParent: string | null;
}

export interface NodePropsChange {
  domId: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface TokenValueChange {
  bucket: 'colors' | 'fonts' | 'spacing' | 'radii' | 'shadows';
  key: string;
  before: string;
  after: string;
}

export interface CopyTextChange {
  domId: string;
  before: string;
  after: string;
}

export interface AssetHashChange {
  path: string;
  before: string;
  after: string;
}

export interface DesignDiff {
  nodes: {
    added: string[];
    removed: string[];
    moved: NodeMove[];
    propsChanged: NodePropsChange[];
  };
  tokens: {
    added: string[];
    removed: string[];
    valueChanged: TokenValueChange[];
  };
  copy: {
    added: string[];
    removed: string[];
    textChanged: CopyTextChange[];
  };
  assets: {
    added: string[];
    removed: string[];
    hashChanged: AssetHashChange[];
  };
  interactivity: {
    added: string[];
    removed: string[];
  };
}

export interface DiffSummary {
  nodesAdded: number;
  nodesRemoved: number;
  nodesMoved: number;
  nodesPropsChanged: number;
  tokensChanged: number;
  copyChanged: number;
  assetsChanged: number;
  interactivityChanged: number;
  /** Total semantic change count — what Atlas shows as "12 changes". */
  totalChanges: number;
}

/** Empty diff — used for the v1 baseline (no parent). */
export function emptyDiff(): DesignDiff {
  return {
    nodes: { added: [], removed: [], moved: [], propsChanged: [] },
    tokens: { added: [], removed: [], valueChanged: [] },
    copy: { added: [], removed: [], textChanged: [] },
    assets: { added: [], removed: [], hashChanged: [] },
    interactivity: { added: [], removed: [] },
  };
}

/** Roll a `DesignDiff` up into a small summary blob. */
export function summarizeDiff(diff: DesignDiff): DiffSummary {
  const summary: DiffSummary = {
    nodesAdded: diff.nodes.added.length,
    nodesRemoved: diff.nodes.removed.length,
    nodesMoved: diff.nodes.moved.length,
    nodesPropsChanged: diff.nodes.propsChanged.length,
    tokensChanged:
      diff.tokens.added.length + diff.tokens.removed.length + diff.tokens.valueChanged.length,
    copyChanged:
      diff.copy.added.length + diff.copy.removed.length + diff.copy.textChanged.length,
    assetsChanged:
      diff.assets.added.length + diff.assets.removed.length + diff.assets.hashChanged.length,
    interactivityChanged: diff.interactivity.added.length + diff.interactivity.removed.length,
    totalChanges: 0,
  };
  summary.totalChanges =
    summary.nodesAdded +
    summary.nodesRemoved +
    summary.nodesMoved +
    summary.nodesPropsChanged +
    summary.tokensChanged +
    summary.copyChanged +
    summary.assetsChanged +
    summary.interactivityChanged;
  return summary;
}

/**
 * Compute the structural diff between `prev` and `next`.
 *
 * Both inputs must conform to the `RenderableDesign` shape from
 * `@chiefaia/atlas-mapper`. Stable DOM-IDs are assumed — if an adapter
 * upstream didn't assign them, atlas-mapper's fingerprint pass will
 * have done so before this function runs.
 */
export function diffDesigns(prev: RenderableDesign, next: RenderableDesign): DesignDiff {
  const out = emptyDiff();

  // ----- Tree diff -------------------------------------------------------
  const prevNodes = flattenTrees(prev);
  const nextNodes = flattenTrees(next);

  const prevIds = new Set(prevNodes.keys());
  const nextIds = new Set(nextNodes.keys());

  for (const id of nextIds) {
    if (!prevIds.has(id)) out.nodes.added.push(id);
  }
  for (const id of prevIds) {
    if (!nextIds.has(id)) out.nodes.removed.push(id);
  }
  for (const id of nextIds) {
    if (!prevIds.has(id)) continue;
    const before = prevNodes.get(id)!;
    const after = nextNodes.get(id)!;
    if ((before.parent ?? null) !== (after.parent ?? null)) {
      out.nodes.moved.push({
        domId: id,
        fromParent: before.parent ?? null,
        toParent: after.parent ?? null,
      });
    }
    if (!propsEqual(before.props, after.props)) {
      out.nodes.propsChanged.push({
        domId: id,
        before: before.props,
        after: after.props,
      });
    }
  }
  // Stable ordering for deterministic JSON.
  out.nodes.added.sort();
  out.nodes.removed.sort();
  out.nodes.moved.sort((a, b) => a.domId.localeCompare(b.domId));
  out.nodes.propsChanged.sort((a, b) => a.domId.localeCompare(b.domId));

  // ----- Token diff ------------------------------------------------------
  const tokenBuckets: Array<TokenValueChange['bucket']> = [
    'colors',
    'fonts',
    'spacing',
    'radii',
    'shadows',
  ];
  for (const bucket of tokenBuckets) {
    const before = tokenBucket(prev.designTokens, bucket);
    const after = tokenBucket(next.designTokens, bucket);
    for (const k of Object.keys(after)) {
      if (!(k in before)) out.tokens.added.push(`${bucket}.${k}`);
      else if (before[k] !== after[k]) {
        out.tokens.valueChanged.push({
          bucket,
          key: k,
          before: before[k]!,
          after: after[k]!,
        });
      }
    }
    for (const k of Object.keys(before)) {
      if (!(k in after)) out.tokens.removed.push(`${bucket}.${k}`);
    }
  }
  out.tokens.added.sort();
  out.tokens.removed.sort();
  out.tokens.valueChanged.sort((a, b) =>
    `${a.bucket}.${a.key}`.localeCompare(`${b.bucket}.${b.key}`),
  );

  // ----- Copy diff -------------------------------------------------------
  const prevCopy = byKey<RenderableCopy>(prev.copy ?? [], (c) => c.domId);
  const nextCopy = byKey<RenderableCopy>(next.copy ?? [], (c) => c.domId);
  for (const id of nextCopy.keys()) {
    if (!prevCopy.has(id)) out.copy.added.push(id);
    else if (prevCopy.get(id)!.text !== nextCopy.get(id)!.text) {
      out.copy.textChanged.push({
        domId: id,
        before: prevCopy.get(id)!.text,
        after: nextCopy.get(id)!.text,
      });
    }
  }
  for (const id of prevCopy.keys()) {
    if (!nextCopy.has(id)) out.copy.removed.push(id);
  }
  out.copy.added.sort();
  out.copy.removed.sort();
  out.copy.textChanged.sort((a, b) => a.domId.localeCompare(b.domId));

  // ----- Asset diff ------------------------------------------------------
  const prevAssets = byKey<RenderableAsset>(prev.assets ?? [], (a) => a.path);
  const nextAssets = byKey<RenderableAsset>(next.assets ?? [], (a) => a.path);
  for (const p of nextAssets.keys()) {
    if (!prevAssets.has(p)) out.assets.added.push(p);
    else {
      const b = prevAssets.get(p)!.contentHash ?? '';
      const a = nextAssets.get(p)!.contentHash ?? '';
      if (b !== a) {
        out.assets.hashChanged.push({ path: p, before: b, after: a });
      }
    }
  }
  for (const p of prevAssets.keys()) {
    if (!nextAssets.has(p)) out.assets.removed.push(p);
  }
  out.assets.added.sort();
  out.assets.removed.sort();
  out.assets.hashChanged.sort((a, b) => a.path.localeCompare(b.path));

  // ----- Interactivity diff ---------------------------------------------
  const prevInter = byKey<RenderableInteractivity>(prev.interactivity ?? [], (i) => i.domId);
  const nextInter = byKey<RenderableInteractivity>(next.interactivity ?? [], (i) => i.domId);
  for (const id of nextInter.keys()) {
    if (!prevInter.has(id)) out.interactivity.added.push(id);
  }
  for (const id of prevInter.keys()) {
    if (!nextInter.has(id)) out.interactivity.removed.push(id);
  }
  out.interactivity.added.sort();
  out.interactivity.removed.sort();

  return out;
}

// ----- Internal helpers --------------------------------------------------

interface FlatNode {
  parent: string | null;
  props: Record<string, unknown>;
}

function flattenTrees(d: RenderableDesign): Map<string, FlatNode> {
  const out = new Map<string, FlatNode>();
  const trees = d.componentTrees ?? {};
  for (const tree of Object.values(trees)) {
    if (!tree?.node) continue;
    walk(tree.node, null, out);
  }
  for (const shared of d.sharedComponents ?? []) {
    if (!shared?.node) continue;
    walk(shared.node, null, out);
  }
  return out;
}

function walk(node: RenderableNode, parent: string | null, out: Map<string, FlatNode>): void {
  if (!node?.domId) {
    // No stable DOM-ID — skip; atlas-mapper should have stamped one.
    // We still recurse into children in case they have IDs.
    for (const child of node.children ?? []) walk(child, parent, out);
    return;
  }
  out.set(node.domId, {
    parent,
    props: extractCompareProps(node),
  });
  for (const child of node.children ?? []) {
    walk(child, node.domId, out);
  }
}

/**
 * Extract the subset of node props that participate in `propsChanged`
 * detection. We deliberately exclude `children`, `provenance`, and
 * `bounds` (these either are structural and tracked elsewhere, or are
 * derived/noisy). We include `tag`, `role`, `level`, `attrs`,
 * `resolvedStyle`, and the FK ref arrays.
 */
function extractCompareProps(node: RenderableNode): Record<string, unknown> {
  const out: Record<string, unknown> = { tag: node.tag, role: node.role };
  if (node.level !== undefined) out.level = node.level;
  if (node.attrs !== undefined) out.attrs = node.attrs;
  if (node.resolvedStyle !== undefined) out.resolvedStyle = node.resolvedStyle;
  if (node.copyRefs !== undefined) out.copyRefs = [...node.copyRefs].sort();
  if (node.assetRefs !== undefined) out.assetRefs = [...node.assetRefs].sort();
  if (node.interactivityRefs !== undefined)
    out.interactivityRefs = [...node.interactivityRefs].sort();
  if (node.sharedRef !== undefined && node.sharedRef !== null) out.sharedRef = node.sharedRef;
  return out;
}

function propsEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

function tokenBucket(
  tokens: RenderableDesignTokens | undefined,
  bucket: TokenValueChange['bucket'],
): Record<string, string> {
  const v = (tokens?.[bucket] ?? {}) as Record<string, string>;
  return v;
}

function byKey<T>(arr: T[], key: (t: T) => string): Map<string, T> {
  const m = new Map<string, T>();
  for (const item of arr) m.set(key(item), item);
  return m;
}

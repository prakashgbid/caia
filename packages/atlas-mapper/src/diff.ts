/**
 * `diff(v1, v2)` — structural diff at the DOM-ID level.
 *
 * Inputs: two `RenderableDesign` versions. Typical use: v1 = previous
 * upload, v2 = newly-ingested re-upload.
 *
 * Output: `{ added, removed, modified }` keyed by DOM-ID. Each
 * modified entry carries one or more structured `DiffReason` codes.
 *
 * # DiffReason taxonomy
 *
 *   `attrs_changed`    — props bag (className, style, href) differs.
 *   `position_changed` — sibling position OR parent changed.
 *   `token_changed`    — `resolvedStyle` differs while `attrs` did not
 *                        (upstream token map was remapped).
 *   `copy_changed`     — `copyRefs` set or referenced text differs.
 *   `asset_changed`    — `assetRefs` set or asset content-hash differs.
 *
 * # Determinism: added/removed/modified all sorted by `domId`; each
 * modified entry's `reasons[]` sorted by canonical reason ordering.
 */

import { buildDomIdMap, type DomIdEntry, type DomIdMap } from './dom-id-map.js';
import type {
  RenderableAsset,
  RenderableCopy,
  RenderableDesign,
} from './renderable-design.js';

export type DiffReason =
  | 'attrs_changed'
  | 'position_changed'
  | 'token_changed'
  | 'copy_changed'
  | 'asset_changed';

const REASON_ORDER: Record<DiffReason, number> = {
  attrs_changed: 0,
  position_changed: 1,
  token_changed: 2,
  copy_changed: 3,
  asset_changed: 4,
};

export interface ModifiedEntry {
  domId: string;
  reasons: DiffReason[];
  before: DomIdEntry;
  after: DomIdEntry;
}

export interface DesignDiff {
  fromDesignVersionId: string;
  toDesignVersionId: string;
  added: DomIdEntry[];
  removed: DomIdEntry[];
  modified: ModifiedEntry[];
  summary: { added: number; removed: number; modified: number; unchanged: number };
}

/**
 * Deep structural equality for plain JSON-ish values. Sufficient for
 * `attrs`, `resolvedStyle`, `bounds` — not a general-purpose deepEqual
 * (doesn't handle cycles or class instances; entries are plain objects).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  const arrA = Array.isArray(a);
  const arrB = Array.isArray(b);
  if (arrA || arrB) {
    if (!arrA || !arrB) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const aKeys = Object.keys(ao).sort();
  const bKeys = Object.keys(bo).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
  }
  for (const k of aKeys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  for (let i = 0; i < aSorted.length; i++) {
    if (aSorted[i] !== bSorted[i]) return false;
  }
  return true;
}

function indexCopy(design: RenderableDesign): Map<string, RenderableCopy> {
  const m = new Map<string, RenderableCopy>();
  if (Array.isArray(design.copy)) {
    for (const c of design.copy) {
      if (c && typeof c.domId === 'string') m.set(c.domId, c);
    }
  }
  return m;
}

function indexAssets(design: RenderableDesign): Map<string, RenderableAsset> {
  const m = new Map<string, RenderableAsset>();
  if (Array.isArray(design.assets)) {
    for (const a of design.assets) {
      if (a && typeof a.path === 'string') m.set(a.path, a);
    }
  }
  return m;
}

/**
 * Compute reasons two same-DOM-ID entries differ. `token_changed` is
 * only reported when `attrs` matched — when attrs already changed,
 * the resolved-style delta is conflated with that change and
 * double-counting hurts diff readability.
 */
function diffReasons(
  before: DomIdEntry,
  after: DomIdEntry,
  v1Copy: Map<string, RenderableCopy>,
  v2Copy: Map<string, RenderableCopy>,
  v1Assets: Map<string, RenderableAsset>,
  v2Assets: Map<string, RenderableAsset>,
): DiffReason[] {
  const reasons: DiffReason[] = [];

  if (before.parentDomId !== after.parentDomId || before.position !== after.position) {
    reasons.push('position_changed');
  }

  const attrsEqual = deepEqual(before.attrs, after.attrs);
  if (!attrsEqual) reasons.push('attrs_changed');

  if (attrsEqual && !deepEqual(before.resolvedStyle, after.resolvedStyle)) {
    reasons.push('token_changed');
  }

  let copyChanged = !sameSet(before.copyRefs, after.copyRefs);
  if (!copyChanged) {
    for (const ref of before.copyRefs) {
      if (!deepEqual(v1Copy.get(ref), v2Copy.get(ref))) {
        copyChanged = true;
        break;
      }
    }
  }
  if (copyChanged) reasons.push('copy_changed');

  let assetChanged = !sameSet(before.assetRefs, after.assetRefs);
  if (!assetChanged) {
    for (const ref of before.assetRefs) {
      const a = v1Assets.get(ref);
      const b = v2Assets.get(ref);
      if (!a && !b) continue;
      if (!a || !b) {
        assetChanged = true;
        break;
      }
      if (a.contentHash !== b.contentHash || a.storageUrl !== b.storageUrl || a.kind !== b.kind) {
        assetChanged = true;
        break;
      }
    }
  }
  if (assetChanged) reasons.push('asset_changed');

  reasons.sort((x, y) => REASON_ORDER[x] - REASON_ORDER[y]);
  return reasons;
}

/**
 * Top-level entry: diff two `RenderableDesign`s.
 */
export function diff(v1: RenderableDesign, v2: RenderableDesign): DesignDiff {
  return diffMaps(buildDomIdMap(v1), buildDomIdMap(v2), v1, v2);
}

/** Longer alias preserved for callers that prefer the explicit name. */
export const diffDesigns = diff;

/** Lower-level: diff already-built maps. */
export function diffMaps(
  v1Map: DomIdMap,
  v2Map: DomIdMap,
  v1: RenderableDesign,
  v2: RenderableDesign,
): DesignDiff {
  const v1Copy = indexCopy(v1);
  const v2Copy = indexCopy(v2);
  const v1Assets = indexAssets(v1);
  const v2Assets = indexAssets(v2);

  const v1Ids = new Set(v1Map.byId.keys());
  const v2Ids = new Set(v2Map.byId.keys());

  const added: DomIdEntry[] = [];
  const removed: DomIdEntry[] = [];
  const modified: ModifiedEntry[] = [];
  let unchanged = 0;

  for (const id of v2Ids) {
    if (!v1Ids.has(id)) {
      const entry = v2Map.byId.get(id);
      if (entry) added.push(entry);
    }
  }
  for (const id of v1Ids) {
    if (!v2Ids.has(id)) {
      const entry = v1Map.byId.get(id);
      if (entry) removed.push(entry);
    }
  }
  for (const id of v1Ids) {
    if (!v2Ids.has(id)) continue;
    const before = v1Map.byId.get(id);
    const after = v2Map.byId.get(id);
    if (!before || !after) continue;
    const reasons = diffReasons(before, after, v1Copy, v2Copy, v1Assets, v2Assets);
    if (reasons.length === 0) unchanged += 1;
    else modified.push({ domId: id, reasons, before, after });
  }

  const byDomId = (a: { domId: string }, b: { domId: string }): number =>
    a.domId < b.domId ? -1 : a.domId > b.domId ? 1 : 0;
  added.sort(byDomId);
  removed.sort(byDomId);
  modified.sort(byDomId);

  return {
    fromDesignVersionId: v1Map.designVersionId,
    toDesignVersionId: v2Map.designVersionId,
    added,
    removed,
    modified,
    summary: {
      added: added.length,
      removed: removed.length,
      modified: modified.length,
      unchanged,
    },
  };
}

/**
 * Design-level structural diff at the DOM-ID layer.
 *
 * Input: two `RenderableDesign` versions (v1, v2). Either the same
 * design at two points in time (re-upload), or two related but
 * distinct designs (rare).
 *
 * Output: `{ added, removed, modified }` keyed by DOM-ID, where each
 * modified entry carries one or more structured `DiffReason` codes:
 *
 *   - `attrs_changed`    — verbatim props bag differs (className,
 *                          style, href, etc.). Most common reason.
 *   - `position_changed` — sibling position under the same parent
 *                          changed, OR the parent itself changed.
 *                          (Note: a parent change usually shifts the
 *                          ID too because the ID's ancestor segment
 *                          includes the parent — so this reason
 *                          mostly fires when adapter-supplied IDs
 *                          decouple from structural position.)
 *   - `token_changed`    — `resolvedStyle` differs even when `attrs`
 *                          matches, indicating the upstream tokens
 *                          changed (`--ink: #1e2a35` → `#000`).
 *   - `copy_changed`     — the set of `copyRefs` differs OR the
 *                          referenced copy text differs in the
 *                          companion `copy[]` table.
 *   - `asset_changed`    — the set of `assetRefs` differs OR the
 *                          asset table's content-hash differs.
 *
 * Output drives:
 *
 *   - Time Machine — replay v1→v2 as a per-DOM-ID animation.
 *   - UX Version Control — surface the diff in atlas's right panel
 *     so the operator approves changes per-element.
 *
 * # Determinism
 *
 * - `added` and `removed` are sorted lexicographically by `domId`.
 * - `modified` is sorted by `domId`; each entry's `reasons` array is
 *   sorted by the enum's canonical ordering.
 * - Reason detection is pure: equality is structural, no field
 *   ordering or whitespace games.
 */

import type { DomIdMap, DomIdEntry } from './dom-id-map.js';
import type { RenderableDesign, RenderableCopy, RenderableAsset } from './renderable-design.js';
import { buildDomIdMap } from './dom-id-map.js';

/**
 * The reason an entry is in the `modified` bucket. Multiple reasons
 * can apply to one DOM-ID — e.g. a CTA whose copy AND href both
 * changed reports `['attrs_changed', 'copy_changed']`.
 */
export type DiffReason =
  | 'attrs_changed'
  | 'position_changed'
  | 'token_changed'
  | 'copy_changed'
  | 'asset_changed';

/** Canonical reason ordering for deterministic output. */
const REASON_ORDER: Record<DiffReason, number> = {
  attrs_changed: 0,
  position_changed: 1,
  token_changed: 2,
  copy_changed: 3,
  asset_changed: 4,
};

/**
 * A single modified entry. Carries v1 and v2 snapshots so consumers
 * can render side-by-side without re-walking either map.
 */
export interface ModifiedEntry {
  domId: string;
  reasons: DiffReason[];
  before: DomIdEntry;
  after: DomIdEntry;
}

/** Top-level diff output. */
export interface DesignDiff {
  /** designVersionId of the v1 input. */
  fromDesignVersionId: string;
  /** designVersionId of the v2 input. */
  toDesignVersionId: string;
  /** DOM-IDs present in v2 but not in v1. */
  added: DomIdEntry[];
  /** DOM-IDs present in v1 but not in v2. */
  removed: DomIdEntry[];
  /** DOM-IDs present in both, with at least one structural difference. */
  modified: ModifiedEntry[];
  /** Convenience summary counters — handy for snapshot tests + dashboards. */
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
  };
}

/* ────────────────────────────────────────────────────────────────── */
/* equality helpers                                                    */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Deep structural equality for plain JSON-ish values. Sufficient for
 * comparing attr bags, resolved styles, and bounds objects emitted by
 * `buildDomIdMap`. Not a general-purpose deepEqual — doesn't handle
 * cyclic structures (the input shape forbids them by spec) or class
 * instances (entries are plain objects).
 *
 * Implementation: structural recursion with key-order normalisation
 * so `{a:1,b:2}` and `{b:2,a:1}` compare equal.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
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

/** Are two string arrays equal as sets? */
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const aSorted = [...a].sort();
  const bSorted = [...b].sort();
  for (let i = 0; i < aSorted.length; i++) {
    if (aSorted[i] !== bSorted[i]) return false;
  }
  return true;
}

/**
 * Build a lookup table from the design's `copy[]` for diff comparison.
 */
function indexCopy(design: RenderableDesign): Map<string, RenderableCopy> {
  const m = new Map<string, RenderableCopy>();
  if (Array.isArray(design.copy)) {
    for (const c of design.copy) {
      if (c && typeof c.domId === 'string') m.set(c.domId, c);
    }
  }
  return m;
}

/**
 * Build a lookup table from the design's `assets[]`. Keys by `path`.
 */
function indexAssets(design: RenderableDesign): Map<string, RenderableAsset> {
  const m = new Map<string, RenderableAsset>();
  if (Array.isArray(design.assets)) {
    for (const a of design.assets) {
      if (a && typeof a.path === 'string') m.set(a.path, a);
    }
  }
  return m;
}

/* ────────────────────────────────────────────────────────────────── */
/* reason detection                                                    */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Compute the reasons two same-DOM-ID entries differ. Returns `[]`
 * when they're structurally identical (unchanged).
 *
 * Reason rules:
 *
 * - `attrs_changed`     — `entry.attrs` differs structurally.
 * - `position_changed`  — `entry.position` OR `entry.parentDomId`
 *                         differs. Same DOM-ID can have a different
 *                         position only when the adapter supplied
 *                         the ID explicitly — derived IDs encode
 *                         position, so position-shifts always show
 *                         up as add+remove instead.
 * - `token_changed`     — `entry.resolvedStyle` differs but `attrs`
 *                         doesn't (i.e. the source attrs are stable
 *                         but the token map points elsewhere). When
 *                         attrs ALSO changed, we only emit
 *                         `attrs_changed` to avoid double-counting.
 * - `copy_changed`      — `copyRefs` set differs, OR any referenced
 *                         copy entry's text/locale/richText differs
 *                         between the two designs.
 * - `asset_changed`     — `assetRefs` set differs, OR any referenced
 *                         asset's contentHash/storageUrl differs.
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

  // Position / parent change
  if (
    before.parentDomId !== after.parentDomId ||
    before.position !== after.position
  ) {
    reasons.push('position_changed');
  }

  // Attribute change
  const attrsEqual = deepEqual(before.attrs, after.attrs);
  if (!attrsEqual) {
    reasons.push('attrs_changed');
  }

  // Token change — only count when attrs matched but resolvedStyle didn't.
  // (If attrs already changed, the resolved-style delta is conflated
  //  with that and we don't want to double-report.)
  if (attrsEqual && !deepEqual(before.resolvedStyle, after.resolvedStyle)) {
    reasons.push('token_changed');
  }

  // Copy change — refs differ, or any ref's text/locale differs.
  let copyChanged = !sameSet(before.copyRefs, after.copyRefs);
  if (!copyChanged) {
    for (const ref of before.copyRefs) {
      const a = v1Copy.get(ref);
      const b = v2Copy.get(ref);
      if (!deepEqual(a, b)) {
        copyChanged = true;
        break;
      }
    }
  }
  if (copyChanged) reasons.push('copy_changed');

  // Asset change — refs differ, or any ref's content-hash/storageUrl differs.
  let assetChanged = !sameSet(before.assetRefs, after.assetRefs);
  if (!assetChanged) {
    for (const ref of before.assetRefs) {
      const a = v1Assets.get(ref);
      const b = v2Assets.get(ref);
      // For assets, content equality means same contentHash + same
      // storageUrl + same kind. Other fields (alt, byteSize, etc.)
      // are surfaced as part of the same change but don't matter for
      // detection — content-hash is the primary signal per spec §1.
      if (!a && !b) continue;
      if (!a || !b) {
        assetChanged = true;
        break;
      }
      if (
        a.contentHash !== b.contentHash ||
        a.storageUrl !== b.storageUrl ||
        a.kind !== b.kind
      ) {
        assetChanged = true;
        break;
      }
    }
  }
  if (assetChanged) reasons.push('asset_changed');

  // Sort by canonical reason ordering for deterministic output.
  reasons.sort((a, b) => REASON_ORDER[a] - REASON_ORDER[b]);
  return reasons;
}

/* ────────────────────────────────────────────────────────────────── */
/* public entry                                                        */
/* ────────────────────────────────────────────────────────────────── */

/**
 * Diff two `RenderableDesign`s at the DOM-ID level.
 *
 * Equivalent to:
 *
 *   const m1 = buildDomIdMap(v1);
 *   const m2 = buildDomIdMap(v2);
 *   return diffMaps(m1, m2, v1, v2);
 *
 * but exposed as a single entry so callers don't have to manage the
 * intermediate maps when they don't need them otherwise.
 *
 * Both inputs MUST pass `buildDomIdMap` cleanly — cycles or duplicate
 * DOM-IDs propagate as `AtlasMapperError`. That's the right failure
 * mode: garbage in → loud error, not silent corruption.
 */
export function diffDesigns(v1: RenderableDesign, v2: RenderableDesign): DesignDiff {
  const m1 = buildDomIdMap(v1);
  const m2 = buildDomIdMap(v2);

  return diffMaps(m1, m2, v1, v2);
}

/**
 * Lower-level variant for callers who already have the maps built
 * (e.g. atlas's storage layer caches them per `designVersionId`).
 *
 * Pass the source `RenderableDesign` payloads alongside the maps so
 * reason detection can resolve `copyRefs` / `assetRefs` against the
 * flat lookup tables on those designs.
 */
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

  // Added — in v2, not in v1.
  for (const id of v2Ids) {
    if (!v1Ids.has(id)) {
      const entry = v2Map.byId.get(id);
      if (entry) added.push(entry);
    }
  }

  // Removed — in v1, not in v2.
  for (const id of v1Ids) {
    if (!v2Ids.has(id)) {
      const entry = v1Map.byId.get(id);
      if (entry) removed.push(entry);
    }
  }

  // Common — same DOM-ID in both. Check for modifications.
  for (const id of v1Ids) {
    if (!v2Ids.has(id)) continue;
    const before = v1Map.byId.get(id);
    const after = v2Map.byId.get(id);
    if (!before || !after) continue;
    const reasons = diffReasons(before, after, v1Copy, v2Copy, v1Assets, v2Assets);
    if (reasons.length === 0) {
      unchanged += 1;
    } else {
      modified.push({ domId: id, reasons, before, after });
    }
  }

  // Deterministic ordering.
  added.sort((a, b) => (a.domId < b.domId ? -1 : a.domId > b.domId ? 1 : 0));
  removed.sort((a, b) => (a.domId < b.domId ? -1 : a.domId > b.domId ? 1 : 0));
  modified.sort((a, b) => (a.domId < b.domId ? -1 : a.domId > b.domId ? 1 : 0));

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

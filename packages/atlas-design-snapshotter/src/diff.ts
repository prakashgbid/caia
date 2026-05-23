/**
 * Diff utilities — summarisation of the structural `Diff` produced by the
 * injected `diffDesigns` function (from @chiefaia/atlas-mapper).
 *
 * The `Diff` itself is opaque to this package — it's whatever atlas-mapper
 * returns. We add a deterministic `summarise()` so the version-picker can
 * render counts cheaply without parsing the full diff jsonb.
 */

import type { Diff, DiffReason, DiffSummary } from './types.js';

const REASON_KEYS: ReadonlyArray<DiffReason> = [
  'attrs_changed',
  'position_changed',
  'token_changed',
  'copy_changed',
  'asset_changed',
];

/**
 * Produces a flat, JSON-serialisable summary of a `Diff`. Used as the
 * `design_versions.diff_summary` value so the dashboard can render a one-liner
 * per version without loading the full diff jsonb.
 */
export function summarise(diff: Diff): DiffSummary {
  const reasonCounts: Record<DiffReason, number> = {
    attrs_changed: 0,
    position_changed: 0,
    token_changed: 0,
    copy_changed: 0,
    asset_changed: 0,
  };
  for (const m of diff.modified) {
    for (const r of m.reasons) {
      // Defensive: a future diff producer could add a new reason; ignore
      // unknown reasons so we never crash on a forward-compatible payload.
      if (REASON_KEYS.includes(r)) {
        reasonCounts[r] += 1;
      }
    }
  }
  return {
    addedCount: diff.added.length,
    removedCount: diff.removed.length,
    modifiedCount: diff.modified.length,
    reasonCounts,
  };
}

/** Empty diff sentinel — used when there is no parent (v1) or no change. */
export function emptyDiff(): Diff {
  return { added: [], removed: [], modified: [] };
}

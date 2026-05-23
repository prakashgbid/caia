/**
 * @caia/ea-dispatcher — applies.ts
 *
 * Per §3.2: the dispatcher filters the architect set to those whose
 * `appliesPredicate(ticket)` returns true. This module is a thin adapter
 * over that predicate so callers can ergonomically check + collect skipped
 * names for telemetry.
 */

import type {
  SpecialistArchitect,
  Ticket,
  ArchitectName,
} from '@caia/architect-kit';

export interface AppliesPartition {
  applicable: readonly SpecialistArchitect[];
  skipped: readonly ArchitectName[];
}

/**
 * Partition an architect set into "applies to this ticket" and "skipped".
 * `appliesPredicate` exceptions count as "skipped" (defensive — a buggy
 * predicate shouldn't block the entire fan-out).
 */
export function partitionByApplies(
  architects: readonly SpecialistArchitect[],
  ticket: Ticket,
): AppliesPartition {
  const applicable: SpecialistArchitect[] = [];
  const skipped: ArchitectName[] = [];
  for (const a of architects) {
    let pass = false;
    try {
      pass = a.sectionContract.architectMeta.appliesPredicate(ticket);
    } catch {
      pass = false;
    }
    if (pass) applicable.push(a);
    else skipped.push(a.name);
  }
  return { applicable, skipped };
}

/**
 * Subset to only the architects in `names`. Used for re-run cycles when the
 * EA Reviewer names a specific subset to recompute.
 */
export function selectByName(
  architects: readonly SpecialistArchitect[],
  names: readonly ArchitectName[],
): readonly SpecialistArchitect[] {
  const want = new Set(names);
  return architects.filter((a) => want.has(a.name));
}

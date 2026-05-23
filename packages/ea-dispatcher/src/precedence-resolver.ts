/**
 * @caia/ea-dispatcher — precedence-resolver.ts
 *
 * Sourced from research/17_architect_framework_spec_2026.md §5.2.
 *
 * Given a set of fired semantic-conflict rules, resolve each one by:
 *  1. Looking up the two architects' ranks in `CANONICAL_PRECEDENCE_LADDER`.
 *  2. Annotating the lower-precedence architect's field with `_dissent`.
 *  3. Leaving the higher-precedence field unmodified.
 *  4. If both architects are at the same rank (or both unknown to the
 *     ladder), surfacing the conflict as `escalated: true` — the reviewer
 *     decides what to do.
 *
 * Mutates the composed blob in place (it's a fresh object owned by the
 * dispatcher; this is fine).
 */

import {
  CANONICAL_PRECEDENCE_LADDER,
  higherPrecedence,
  precedenceRank,
  type ArchitectName,
} from '@caia/architect-kit';
import type { ConflictRecord } from './types.js';
import type { FiredRule } from './conflict-rules.js';

/**
 * Apply the precedence ladder to the fired rules. Returns the set of
 * resolved `ConflictRecord`s for the dispatcher's audit trail.
 */
export function resolveConflicts(
  fired: readonly FiredRule[],
  composed: Record<string, unknown>,
  ladder: readonly ArchitectName[] = CANONICAL_PRECEDENCE_LADDER,
): readonly ConflictRecord[] {
  const out: ConflictRecord[] = [];
  for (const { rule } of fired) {
    const [a, b] = rule.architects;
    // Same-architect rules (e.g. frontend tokens vs frontend breakpoints) —
    // can't apply inter-precedence; surface as escalation.
    if (a === b) {
      out.push({
        ruleId: rule.id,
        winner: a,
        loser: b,
        fields: rule.fields,
        escalated: true,
      });
      continue;
    }
    const winner = higherPrecedence(a, b, ladder);
    if (winner === null) {
      // Same rank or both unknown — escalate.
      out.push({
        ruleId: rule.id,
        winner: a,
        loser: b,
        fields: rule.fields,
        escalated: true,
      });
      continue;
    }
    const loser = winner === a ? b : a;
    // Annotate the loser's field with _dissent. We only annotate fields
    // that are owned by the loser — we identify them by prefix matching
    // against the architect name.
    for (const field of rule.fields) {
      // Only annotate if this field's prefix matches the loser. The fields
      // list in a rule includes both sides; we want to flag the loser only.
      if (!fieldBelongsTo(field, loser)) continue;
      annotateDissent(composed, field, {
        conflictsWith: winner,
        overriddenReason: rule.id,
      });
    }
    out.push({
      ruleId: rule.id,
      winner,
      loser,
      fields: rule.fields,
      escalated: false,
    });
  }
  return out;
}

/**
 * The architect that owns a path = the path's first dotted segment maps to
 * the architect's name. e.g. `'frontend.componentTree'` → `frontend`.
 *
 * We use this convention everywhere; the SectionContract paths follow it.
 */
export function fieldBelongsTo(
  fieldPath: string,
  architectName: ArchitectName,
): boolean {
  const prefix = fieldPath.split('.')[0];
  if (!prefix) return false;
  // Direct match
  if (prefix === architectName) return true;
  // Some architects own sub-namespaces with a different prefix.
  // e.g. featureFlagging owns `featureFlags.*`.
  const aliasMap: Record<string, readonly string[]> = {
    featureFlagging: ['featureFlags'],
    accessibility: ['a11y'],
  };
  return (aliasMap[architectName] ?? []).includes(prefix);
}

/**
 * Annotate a field's value with a `_dissent` block. If the value is already
 * an object, merges `_dissent` into it; otherwise wraps it in
 * `{ value: <original>, _dissent: {...} }` so we don't lose the original.
 */
export function annotateDissent(
  composed: Record<string, unknown>,
  path: string,
  dissent: { conflictsWith: ArchitectName; overriddenReason: string },
): void {
  const original = composed[path];
  if (original === undefined) {
    // Field doesn't actually exist — record dissent on its own.
    composed[path] = { _dissent: dissent };
    return;
  }
  if (typeof original === 'object' && original !== null && !Array.isArray(original)) {
    composed[path] = { ...(original as Record<string, unknown>), _dissent: dissent };
    return;
  }
  composed[path] = { value: original, _dissent: dissent };
}

/**
 * Pure helper — given two architect names, return the one that wins under
 * the canonical ladder, or null on tie / both unknown.
 */
export function winnerOf(
  a: ArchitectName,
  b: ArchitectName,
  ladder: readonly ArchitectName[] = CANONICAL_PRECEDENCE_LADDER,
): { winner: ArchitectName | null; ranks: [number, number] } {
  return {
    winner: higherPrecedence(a, b, ladder),
    ranks: [precedenceRank(a, ladder), precedenceRank(b, ladder)],
  };
}

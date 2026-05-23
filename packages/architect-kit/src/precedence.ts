/**
 * @caia/architect-kit — canonical precedence ladder.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §5.2.
 *
 * When the dispatcher detects a *semantic* conflict between two architects
 * (e.g. SEO wants to preload an image that Performance wants to lazy-load),
 * it resolves by precedence: the higher-precedence architect's decision
 * survives unmodified; the lower-precedence field gets a `_dissent`
 * annotation pointing at the rule that fired.
 *
 * Field-level conflicts are impossible by construction (the SectionContract
 * disjointness invariant) — this ladder applies only to semantic conflicts
 * the dispatcher's rule registry detects post-composition.
 *
 * Note: the user-facing prompt described the ladder as
 *   `Security > A11y > SEO > Performance > Frontend visual > Analytics > others`
 * but the spec puts DevOps at #2 (operator-on-hook for a bad deploy beats
 * a11y legal exposure). We follow the spec; the operator can override per
 * site if needed by re-registering the architect with a different rank.
 */

import type { ArchitectName } from './architect-section-contract.js';

/**
 * Ordered list — lower index = higher precedence. The dispatcher uses
 * `precedenceRank(name)` to compare two architects.
 *
 * 17 entries. Any architect-kit roster change must update this array.
 */
export const CANONICAL_PRECEDENCE_LADDER: readonly ArchitectName[] = [
  'security', // legal & compliance veto — highest
  'devops', // operator-on-hook for a bad deploy
  'a11y', // legal exposure WCAG 2.2 AA
  'seo', // locked playbook non-negotiable
  'performance', // Lighthouse ≥95 gate
  'abTesting', // statistical correctness
  'featureFlagging', // rollout safety
  'apiGateway', // boundary integrity
  'observability', // operability (read-only — sits below safety/perf)
  'analytics', // compliance-sensitive (consent gating)
  'database', // schema correctness
  'backend', // functional correctness
  'aiml', // cost/quality tradeoffs
  'frontend', // visual fidelity — below a11y/seo/perf
  'timeMachine', // operator-facing; not safety-critical
  'uxVersionControl', // operator-facing; not safety-critical
  'testing', // advisory strategy
] as const;

/** Total number of architects in the canonical ladder. */
export const CANONICAL_ARCHITECT_COUNT = CANONICAL_PRECEDENCE_LADDER.length;

/**
 * Look up the rank of an architect (1..N). Lower = higher precedence.
 * Returns `Infinity` if the architect is not in the canonical ladder
 * (bespoke architects can register with their own rank).
 */
export function precedenceRank(
  architectName: ArchitectName,
  ladder: readonly ArchitectName[] = CANONICAL_PRECEDENCE_LADDER,
): number {
  const idx = ladder.indexOf(architectName);
  return idx === -1 ? Infinity : idx + 1;
}

/**
 * Total comparator over architect names — sortable into precedence order.
 * Higher precedence (lower rank) comes first.
 */
export function comparePrecedence(
  a: ArchitectName,
  b: ArchitectName,
  ladder: readonly ArchitectName[] = CANONICAL_PRECEDENCE_LADDER,
): number {
  return precedenceRank(a, ladder) - precedenceRank(b, ladder);
}

/**
 * Returns the higher-precedence architect of the two. On tie (both at
 * Infinity, both at same rank), returns `null` — caller should surface the
 * conflict as `requiresEscalation`.
 */
export function higherPrecedence(
  a: ArchitectName,
  b: ArchitectName,
  ladder: readonly ArchitectName[] = CANONICAL_PRECEDENCE_LADDER,
): ArchitectName | null {
  const ra = precedenceRank(a, ladder);
  const rb = precedenceRank(b, ladder);
  if (ra === rb) return null;
  return ra < rb ? a : b;
}

/**
 * Asserts the ladder is unique-by-name and has the expected count.
 * Throws on violation. Used in tests and at registry-boot to catch typos.
 */
export function assertLadderShape(
  ladder: readonly ArchitectName[],
  expectedCount = CANONICAL_ARCHITECT_COUNT,
): void {
  if (ladder.length !== expectedCount) {
    throw new Error(
      `[architect-kit] precedence ladder has ${ladder.length} entries; expected ${expectedCount}.`,
    );
  }
  const seen = new Set<string>();
  for (const name of ladder) {
    if (seen.has(name)) {
      throw new Error(`[architect-kit] precedence ladder has duplicate entry '${name}'.`);
    }
    seen.add(name);
  }
}

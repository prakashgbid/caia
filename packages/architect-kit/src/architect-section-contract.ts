/**
 * @caia/architect-kit — ArchitectSectionContract
 *
 * Sourced from research/17_architect_framework_spec_2026.md §1.3 + §9.
 *
 * Why a NEW interface (parallel to `@chiefaia/ticket-template`'s SectionContract):
 * - The base SectionContract is keyed on PO/BA/EA/Test-Design agent roles
 *   and integrates with the Story Validator's rubric pipeline (Zod schemas,
 *   relevance prompts, fix hints).
 * - Architect contracts are different beasts: they declare disjoint JSONB
 *   field ownership over `tickets.architecture`, dependency edges to other
 *   architects, a precedence-ladder rank, an `appliesPredicate(ticket)`
 *   filter, and a fan-out policy. They don't participate in rubric scoring.
 *
 * Strict-additive design: the spec §9 originally suggested extending the
 * base SectionContract with an optional `architectMeta` field. We instead
 * make ArchitectSectionContract its own type to avoid forcing changes on
 * `@chiefaia/ticket-template`. The dispatcher accepts both shapes via duck
 * typing — anything with a `sections: { name: string }[]` array and an
 * `architectMeta` block is treated as an architect contract.
 */

import type { Ticket } from './types.js';

/** Architect role name. By convention, matches the package name minus `-architect`. */
export type ArchitectName = string;

/**
 * Fan-out policy controls when the dispatcher invokes the architect.
 *  - `always`       — runs on every ticket that matches `appliesPredicate`.
 *  - `conditional`  — runs only when an upstream architect signals demand
 *                     (e.g. A/B Testing runs only when Analytics flags a
 *                     candidate metric).
 *  - `gated`        — runs only when an operator explicitly enables it on
 *                     the ticket (e.g. heavyweight AI/ML on a non-AI page).
 */
export type FanoutPolicy = 'always' | 'conditional' | 'gated';

/**
 * One JSONB section the architect owns. The `path` is the dotted key under
 * `tickets.architecture` (e.g. `'frontend.componentTree'`). Disjointness
 * across architects is verified at registration time.
 */
export interface ArchitectSectionSpec {
  /** Dotted JSON path under `tickets.architecture`. Globally unique. */
  path: string;
  /** Short, operator-facing description. */
  description: string;
  /**
   * Whether this path is required to be populated for the architect's
   * output to be considered `ok` (vs `partial`). The reviewer's
   * completeness lens checks this.
   */
  required: boolean;
}

/**
 * Architect-specific metadata: the wave-orchestration knobs that the
 * dispatcher reads to compute the dependency graph, precedence ordering,
 * and per-ticket filtering.
 */
export interface ArchitectMeta {
  /** Other architect names this architect must run after. May be empty. */
  dependsOn: readonly ArchitectName[];
  /**
   * Precedence rank (1..N, lower = higher precedence). Used for semantic
   * conflict resolution. The canonical 17-architect ladder lives in
   * `precedence.ts` — bespoke architects should pick a rank that doesn't
   * collide with the canonical set.
   */
  precedenceLevel: number;
  fanoutPolicy: FanoutPolicy;
  /**
   * Per-ticket gate: returns true iff the architect applies to this ticket.
   * Pure function — must be deterministic given the input.
   */
  appliesPredicate: (ticket: Ticket) => boolean;
  /** Preferred model for budget defaults. */
  runtimeModel: 'haiku' | 'sonnet' | 'opus';
}

/**
 * The architect's section contract — the disjoint-write declaration plus
 * metadata. The dispatcher reads this at registration time to build the
 * dependency graph and validate field-disjointness across the roster.
 */
export interface ArchitectSectionContract {
  /** Stable contract ID. Convention: `<name>-architect.v<major>`. */
  contractId: string;
  /** Architect role name (matches the SpecialistArchitect's `name`). */
  architectName: ArchitectName;
  /** Human-readable semver-ish version. */
  version: string;
  /** Sections this architect owns. */
  sections: readonly ArchitectSectionSpec[];
  /** Wave/precedence metadata. */
  architectMeta: ArchitectMeta;
}

// ─── Utilities ─────────────────────────────────────────────────────────────

/**
 * Set of section paths the contract claims. Helpful for disjointness checks
 * and composition.
 */
export function contractPaths(
  contract: ArchitectSectionContract,
): readonly string[] {
  return contract.sections.map((s) => s.path);
}

/**
 * Validate that all paths within a single contract are unique (a contract
 * declaring `frontend.tokens` twice is a bug — catch at registration).
 *
 * Returns the duplicate paths, or an empty array if none.
 */
export function findDuplicatePaths(
  contract: ArchitectSectionContract,
): readonly string[] {
  const seen = new Set<string>();
  const dups: string[] = [];
  for (const spec of contract.sections) {
    if (seen.has(spec.path)) dups.push(spec.path);
    seen.add(spec.path);
  }
  return dups;
}

/**
 * Validate that two contracts' section paths are disjoint. Returns the
 * intersecting paths (empty array if disjoint as required).
 */
export function findOverlappingPaths(
  a: ArchitectSectionContract,
  b: ArchitectSectionContract,
): readonly string[] {
  const aSet = new Set(contractPaths(a));
  return contractPaths(b).filter((p) => aSet.has(p));
}

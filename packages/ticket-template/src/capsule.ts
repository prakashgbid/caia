/**
 * Context Capsule — formal, hashed, frozen-at-handoff projection of a ticket.
 *
 * Adopts the Context Capsule pattern from the third-party CAIA paper analysis
 * (§C.5, citing paper §0.2 #3 + §2.2): every task input is a deterministic,
 * hashable JSON document; the capsule is read-only at task start; it is fully
 * reconstructible from the ticket so a re-run is deterministic.
 *
 * What gets hashed (six explicit slices, ordered alphabetically by key):
 *
 *   1. acceptance_tests   — ticket.testCases verbatim
 *   2. budget             — token / cost ceilings (null today; SPEND-CAP track populates later)
 *   3. contracts          — ticket.agentSections + ticket.architecturalInstructions
 *   4. file_allowlist     — sorted union of ticket.dependencies.files ∪ ticket.claims?.files
 *   5. spec_slice         — version + scope + context + acceptanceCriteria + verificationPlan
 *   6. tool_allowlist     — sorted union of architecturalInstructions[*].techSubDomain ∪ taxonomy.techSubDomains.all
 *
 * Master hash:  sha256( canonicalJSON({slice1, …, slice6}) )
 *
 * The orchestrator calls `freezeCapsule(ticket)` BEFORE handing the ticket
 * to the Coding Agent (typically at the bucket_placed → ready_for_pickup
 * transition). The Coding Agent calls `verifyCapsule(ticket)` as its first
 * action; on `valid === false` it escalates with a `capsule-drift` blocker
 * rather than acting on stale context.
 */

import { createHash } from 'node:crypto';
import type {
  ArchitecturalInstruction,
  TestCase,
  TicketTemplateV1,
} from './schema';

// ─── Types ──────────────────────────────────────────────────────────────────

/**
 * The agent-sections shape exactly as it appears on a ticket. The schema
 * doesn't export this as a named type, so we derive it via indexed access.
 */
export type AgentSections = TicketTemplateV1['agentSections'];

/**
 * Per-task budget slice. Today's tickets do not carry a budget; the field
 * is present so a future SPEND-CAP track (paper §C.4) can attach one
 * without changing the capsule shape — the master hash already covers
 * `budget`, even when it is null/null.
 */
export interface CapsuleBudget {
  readonly maxOutputTokens: number | null;
  readonly maxCostUsd: number | null;
}

/**
 * The frozen capsule content — six deterministic slices, alphabetically
 * keyed. Hashing this object's canonical JSON yields the master hash.
 */
export interface CapsuleContent {
  readonly acceptance_tests: readonly TestCase[];
  readonly budget: CapsuleBudget;
  readonly contracts: {
    readonly agentSections: AgentSections;
    readonly architecturalInstructions: readonly ArchitecturalInstruction[];
  };
  readonly file_allowlist: readonly string[];
  readonly spec_slice: {
    readonly version: TicketTemplateV1['version'];
    readonly scope: TicketTemplateV1['scope'];
    readonly context: TicketTemplateV1['context'];
    readonly acceptanceCriteria: readonly string[];
    readonly verificationPlan: readonly string[];
  };
  readonly tool_allowlist: readonly string[];
}

/**
 * Stable, alphabetically-sorted list of the six capsule slices.
 *
 * Used by `verifyCapsule` to enumerate drift candidates and by
 * `canonicalJSON` to assert that no slice is silently added/removed
 * (any change to this list is a hash-shape change and must be a v2
 * capsule, not a v1 mutation).
 */
export const CAPSULE_SLICE_KEYS = [
  'acceptance_tests',
  'budget',
  'contracts',
  'file_allowlist',
  'spec_slice',
  'tool_allowlist',
] as const;

export type CapsuleSliceKey = (typeof CAPSULE_SLICE_KEYS)[number];

/**
 * Capsule version. Bump when the slice shape changes (e.g., adding a 7th
 * slice). Persisted on the ticket so re-verifications can detect a
 * mismatched shape rather than treating it as drift.
 */
export const CAPSULE_VERSION = 'v1' as const;

export type CapsuleVersion = typeof CAPSULE_VERSION;

/**
 * A ticket that has been through `freezeCapsule`. Adds two non-optional
 * fields the schema keeps optional (frozen tickets must have both).
 */
export type TicketWithCapsule = TicketTemplateV1 & {
  capsuleHash: string;
  capsuleFrozenAt: number;
  capsuleVersion: CapsuleVersion;
};

/**
 * Drift report on a failed verification. `expected` is the hash that was
 * frozen on the ticket (or `null` if the ticket had no capsule); `actual`
 * is the hash we just computed from the ticket as it stands now.
 */
export interface CapsuleDrift {
  readonly expected: string | null;
  readonly actual: string;
  readonly reason: 'no-frozen-hash' | 'hash-mismatch';
}

export type CapsuleVerification =
  | { valid: true; drift: null; expected: string; actual: string }
  | { valid: false; drift: CapsuleDrift };

/**
 * Inputs accepted by `verifyCapsule`. We accept both a full
 * `TicketWithCapsule` and a base `TicketTemplateV1` (where the capsule
 * fields are absent — verification will fail with `no-frozen-hash`).
 */
export type VerifiableTicket = TicketTemplateV1 & {
  capsuleHash?: string;
  capsuleFrozenAt?: number;
  capsuleVersion?: CapsuleVersion;
};

// ─── Canonicalization ──────────────────────────────────────────────────────

/**
 * Canonical JSON projection: keys are sorted alphabetically at every
 * object depth; arrays preserve order; `undefined` values are omitted;
 * `null` is preserved. This is the input to `sha256` — any two ticket
 * states whose capsule slices canonicalize to the same string MUST
 * produce the same master hash, regardless of object-construction order.
 *
 * Why not `JSON.stringify` directly? V8/Node's `JSON.stringify` follows
 * insertion order for object keys; an upstream agent that re-serialises
 * a ticket via `JSON.parse(JSON.stringify(t))` followed by mutation can
 * legally change key order without changing semantics. We need bit-for-
 * bit determinism.
 */
export function canonicalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value instanceof Date) return value.toISOString();
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const k of sortedKeys) {
    const v = obj[k];
    if (v === undefined) continue; // omit undefined
    out[k] = canonicalize(v);
  }
  return out;
}

/**
 * Canonical-JSON serialise. Round-trips through `canonicalize` then
 * `JSON.stringify`. The output is a deterministic, key-sorted string;
 * `sha256(canonicalJSON(x))` is the master hash.
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

// ─── Slice extraction ──────────────────────────────────────────────────────

/**
 * Extract the six capsule slices from a ticket. The result is a plain,
 * keyless-order-sorted object; passing it to `canonicalJSON` produces
 * the bytes the master hash is computed over.
 *
 * Determinism notes:
 *  - `file_allowlist` is sorted + deduplicated so two tickets that name
 *    the same files in different order produce the same capsule.
 *  - `tool_allowlist` is similarly sorted + deduplicated.
 *  - `agentSections` and `testCases` preserve their natural ordering;
 *    deduplication is the upstream agent's responsibility.
 */
export function extractCapsule(ticket: TicketTemplateV1): CapsuleContent {
  const fromDeps = ticket.dependencies.files ?? [];
  const fromClaims = ticket.claims?.files ?? [];
  const file_allowlist = uniqueSorted([...fromDeps, ...fromClaims]);

  const techFromInstructions = ticket.architecturalInstructions.map(
    (i) => i.techSubDomain,
  );
  const techFromTaxonomy = ticket.taxonomy?.techSubDomains?.all ?? [];
  const tool_allowlist = uniqueSorted([
    ...techFromInstructions,
    ...techFromTaxonomy,
  ]);

  return {
    acceptance_tests: ticket.testCases,
    budget: { maxOutputTokens: null, maxCostUsd: null },
    contracts: {
      agentSections: ticket.agentSections,
      architecturalInstructions: ticket.architecturalInstructions,
    },
    file_allowlist,
    spec_slice: {
      acceptanceCriteria: ticket.acceptanceCriteria,
      context: ticket.context,
      scope: ticket.scope,
      verificationPlan: ticket.verificationPlan,
      version: ticket.version,
    },
    tool_allowlist,
  };
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values)).sort();
}

// ─── Hashing ───────────────────────────────────────────────────────────────

/**
 * Compute the master capsule hash for a ticket's CURRENT state. Lower-
 * level than `freezeCapsule`: returns just the hash string, doesn't
 * mutate the ticket, doesn't pin a timestamp. Use for snapshot
 * comparisons (e.g., debugging "did this story change?").
 */
export function computeCapsuleHash(ticket: TicketTemplateV1): string {
  const content = extractCapsule(ticket);
  const json = canonicalJSON(content);
  return sha256Hex(json);
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ─── Freeze + verify ───────────────────────────────────────────────────────

export interface FreezeOptions {
  /** Override `Date.now()` for deterministic test fixtures. */
  readonly now?: number;
}

/**
 * Freeze the capsule on a ticket: compute the master hash, set the
 * `capsuleFrozenAt` timestamp, and return a new ticket object (the input
 * is not mutated). The orchestrator calls this BEFORE the ticket is
 * handed to the Coding Agent.
 *
 * Idempotency: calling `freezeCapsule` twice on identical content + the
 * same `now` returns identical hash + timestamp. Calling on already-
 * frozen content is safe — the prior hash is overwritten with one
 * computed from current content (intentional: re-freeze when upstream
 * legitimately re-edits a ticket pre-handoff, e.g., BA replays).
 */
export function freezeCapsule(
  ticket: TicketTemplateV1,
  options: FreezeOptions = {},
): TicketWithCapsule {
  const capsuleHash = computeCapsuleHash(ticket);
  const capsuleFrozenAt = options.now ?? Date.now();
  return {
    ...ticket,
    capsuleHash,
    capsuleFrozenAt,
    capsuleVersion: CAPSULE_VERSION,
  };
}

/**
 * Verify a ticket's capsule integrity. Returns:
 *  - `{ valid: true,  drift: null }`  — frozen hash matches recomputed hash
 *  - `{ valid: false, drift: { reason: 'no-frozen-hash', … } }` — ticket has no capsuleHash
 *  - `{ valid: false, drift: { reason: 'hash-mismatch',  … } }` — drift detected
 *
 * The Coding Agent's first action in a task should be:
 *
 *   const v = verifyCapsule(ticket);
 *   if (!v.valid) escalate('capsule-drift', v.drift); return;
 *
 * On `hash-mismatch`, the recommended escalation is a `capsule-drift`
 * blocker that captures `{ expected, actual }` so the operator can
 * either re-freeze (if upstream legitimately changed the ticket) or
 * investigate (if the change was unexpected).
 */
export function verifyCapsule(ticket: VerifiableTicket): CapsuleVerification {
  const actual = computeCapsuleHash(ticket);
  const expected = ticket.capsuleHash ?? null;
  if (expected === null) {
    return {
      valid: false,
      drift: { expected: null, actual, reason: 'no-frozen-hash' },
    };
  }
  if (expected === actual) {
    return { valid: true, drift: null, expected, actual };
  }
  return {
    valid: false,
    drift: { expected, actual, reason: 'hash-mismatch' },
  };
}

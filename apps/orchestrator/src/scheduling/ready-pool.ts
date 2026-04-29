/**
 * Ready pool — BUCKET-009.
 *
 * Maintains the cross-bucket pool of stories that are eligible for a
 * worker to pick up. A story is "ready" iff:
 *   1. its `blockedBy` chain is satisfied (every blocker is `done`/`verified`)
 *   2. the fine-grained-claims gate passes (high/critical risk requires
 *      claims.files non-empty — proposal §9.3)
 *   3. its claims don't overlap with any currently in-flight story's
 *      claims on files/schemas/apiRoutes
 *
 * The pool is rebuilt incrementally on `story.done` and `story.in-flight`
 * events; for MVP we expose a pure recompute() that the placer / executor
 * can call. Persistence is not required — the pool is derivable from
 * `stories.*` whenever needed.
 */

import {
  type Claims,
  parseClaims,
  checkClaimsConflict,
  passesFineGrainedClaimsGate,
} from './resource-claim-checker';

// ─── Story snapshot (what the pool needs to know) ──────────────────────────

export interface StorySnapshot {
  id: string;
  status: string;
  bucketId: string | null;
  blockedBy: string[];
  risk: string | null;
  priorityBucket: string | null;
  claims: Claims;
}

/** Parse a raw story row into the shape the pool uses. */
export function snapshotStory(row: {
  id: string;
  status: string;
  bucketId?: string | null;
  blockedByJson?: string | null;
  risk?: string | null;
  priorityBucket?: string | null;
  claimsJson?: string | null;
}): StorySnapshot {
  let blockedBy: string[] = [];
  try {
    const parsed = JSON.parse(row.blockedByJson ?? '[]');
    if (Array.isArray(parsed)) blockedBy = parsed.filter((s) => typeof s === 'string');
  } catch {
    /* malformed JSON treated as no blockers */
  }
  return {
    id: row.id,
    status: row.status,
    bucketId: row.bucketId ?? null,
    blockedBy,
    risk: row.risk ?? null,
    priorityBucket: row.priorityBucket ?? null,
    claims: parseClaims(row.claimsJson ?? null),
  };
}

// ─── Status sets ───────────────────────────────────────────────────────────

const DONE_STATUSES = new Set(['verified', 'done', 'completed']);
const IN_FLIGHT_STATUSES = new Set(['in_progress', 'running', 'partial']);
const READY_STATUSES = new Set(['pending', 'ready']);

export function isDone(status: string): boolean {
  return DONE_STATUSES.has(status);
}
export function isInFlight(status: string): boolean {
  return IN_FLIGHT_STATUSES.has(status);
}
export function isPotentiallyReady(status: string): boolean {
  return READY_STATUSES.has(status);
}

// ─── Recompute ─────────────────────────────────────────────────────────────

export interface PoolEntry {
  storyId: string;
  bucketId: string | null;
  risk: string | null;
  priorityBucket: string | null;
}

export interface DeferredEntry extends PoolEntry {
  reason: 'blocked-by' | 'claims-gate' | 'claims-conflict';
  blockerIds: string[];
  /** Populated when reason === 'claims-conflict' — the first overlapping in-flight story. */
  conflictingStoryId?: string;
  conflictingClaim?: { kind: 'file' | 'schema' | 'apiRoute'; value: string };
}

export interface RecomputeResult {
  ready: PoolEntry[];
  deferred: DeferredEntry[];
  inFlight: PoolEntry[];
}

/**
 * Pure recompute. Given the current `stories` snapshot set, partition into
 * `ready`, `deferred` (with reasons), and `inFlight`.
 *
 * Ordering of `ready`: by priorityBucket (P0 first), then story id (stable).
 * The executor's pickup-time check should re-run `checkClaimsConflict` against
 * the latest in-flight set — `recompute` is a single point-in-time view.
 */
export function recompute(stories: StorySnapshot[]): RecomputeResult {
  const byId = new Map<string, StorySnapshot>();
  for (const s of stories) byId.set(s.id, s);

  const inFlight: PoolEntry[] = [];
  const ready: PoolEntry[] = [];
  const deferred: DeferredEntry[] = [];

  // First pass: build the in-flight set.
  for (const s of stories) {
    if (isInFlight(s.status)) {
      inFlight.push({
        storyId: s.id,
        bucketId: s.bucketId,
        risk: s.risk,
        priorityBucket: s.priorityBucket,
      });
    }
  }
  const inFlightSnapshots = stories.filter((s) => isInFlight(s.status));

  // Second pass: classify the candidates.
  for (const s of stories) {
    if (!isPotentiallyReady(s.status)) continue;

    // 1. blockedBy gate.
    const unfinishedBlockers = s.blockedBy.filter((bid) => {
      const blocker = byId.get(bid);
      return !blocker || !isDone(blocker.status);
    });
    if (unfinishedBlockers.length > 0) {
      deferred.push({
        storyId: s.id,
        bucketId: s.bucketId,
        risk: s.risk,
        priorityBucket: s.priorityBucket,
        reason: 'blocked-by',
        blockerIds: unfinishedBlockers,
      });
      continue;
    }

    // 2. fine-grained-claims gate (high/critical risk).
    if (!passesFineGrainedClaimsGate(s.risk, s.claims)) {
      deferred.push({
        storyId: s.id,
        bucketId: s.bucketId,
        risk: s.risk,
        priorityBucket: s.priorityBucket,
        reason: 'claims-gate',
        blockerIds: [],
      });
      continue;
    }

    // 3. claims-conflict gate.
    const conflict = checkClaimsConflict(
      { id: s.id, claims: s.claims },
      inFlightSnapshots.map((other) => ({ id: other.id, claims: other.claims })),
    );
    if (conflict.conflict) {
      const firstFile = conflict.overlappingFiles[0];
      const firstSchema = conflict.overlappingSchemas[0];
      const firstRoute = conflict.overlappingApiRoutes[0];
      const conflictingClaim: DeferredEntry['conflictingClaim'] = firstFile
        ? { kind: 'file', value: firstFile }
        : firstSchema
          ? { kind: 'schema', value: firstSchema }
          : firstRoute
            ? { kind: 'apiRoute', value: firstRoute }
            : undefined;
      deferred.push({
        storyId: s.id,
        bucketId: s.bucketId,
        risk: s.risk,
        priorityBucket: s.priorityBucket,
        reason: 'claims-conflict',
        blockerIds: conflict.blockerStoryId ? [conflict.blockerStoryId] : [],
        conflictingStoryId: conflict.blockerStoryId,
        conflictingClaim,
      });
      continue;
    }

    ready.push({
      storyId: s.id,
      bucketId: s.bucketId,
      risk: s.risk,
      priorityBucket: s.priorityBucket,
    });
  }

  // Stable order: P0 < P1 < P2 < P3 < null, then story id ascending.
  const PRIORITY_ORDER = ['P0', 'P1', 'P2', 'P3'];
  ready.sort((a, b) => {
    const ai = a.priorityBucket ? PRIORITY_ORDER.indexOf(a.priorityBucket) : 999;
    const bi = b.priorityBucket ? PRIORITY_ORDER.indexOf(b.priorityBucket) : 999;
    if (ai !== bi) return ai - bi;
    return a.storyId.localeCompare(b.storyId);
  });

  return { ready, deferred, inFlight };
}

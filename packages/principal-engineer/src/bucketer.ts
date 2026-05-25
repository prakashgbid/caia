/**
 * Wave + bucket assignment for the Principal Engineer (Stage 12).
 *
 * Given a typed dependency graph, the bucketer:
 *   1. Computes topo levels (pure; no I/O).
 *   2. Groups tickets per level.
 *   3. Splits each level into `parallel-bucket-N` shards capped at
 *      `perWaveCap` (clamped by tenant tier).
 *   4. Detects in-level resource conflicts (two tickets in the same level
 *      claiming the same resourceLock) and pushes the loser into a
 *      `sequential-after-<predecessorBucket>` bucket in the next wave.
 *   5. Emits a WavePlan whose buckets are content-addressed (stable hash
 *      over (waveIndex, kind, ticketIds)) so identical inputs always
 *      produce identical bucket ids.
 *
 * Side-effect free; safe to call from any context.
 */

import { createHash } from 'node:crypto';

import {
  buildDependencyGraph,
  groupByLevel,
  topoLevels,
} from './dependency-graph.js';
import type {
  BucketInput,
  BucketKind,
  SpsBucketPolicies,
  TenantTier,
  Ticket,
  WaveBucket,
  WavePlan,
} from './types.js';
import { TIER_CAPS } from './types.js';

/** Default per-wave parallelism when neither tier nor override nor SPS specifies otherwise. */
export const DEFAULT_PER_WAVE_CAP = 5;

/** Default bucket policies — used when no SPS YAML is supplied (per EA modifier #3). */
export const DEFAULT_BUCKET_POLICIES: SpsBucketPolicies = Object.freeze({
  global: Object.freeze({
    spawnDispatchMinIntervalS: 5,
    conflictCheckDefault: 'fail-closed' as const,
  }),
});

/**
 * Resolve the per-wave concurrency cap.
 *
 *   cap = min(
 *     tenantOverrideCap ?? TIER_CAPS[tenantTier] ?? DEFAULT_PER_WAVE_CAP,
 *     TIER_CAPS[tenantTier],
 *   )
 *
 * The override can never exceed the tier ceiling. This matches the
 * subscription-only invariant: tenants cannot spend past their tier.
 */
export function resolvePerWaveCap(
  tenantTier: TenantTier,
  tenantOverrideCap?: number,
): number {
  const tierCap = TIER_CAPS[tenantTier];
  if (tenantOverrideCap === undefined) return tierCap;
  const requested = Math.max(1, Math.floor(tenantOverrideCap));
  return Math.min(requested, tierCap);
}

/**
 * Compute a stable, content-addressed bucket id. Identical inputs always
 * yield the same id.
 */
function bucketIdOf(
  waveIndex: number,
  assignment: BucketKind,
  ticketIds: readonly string[],
): string {
  const h = createHash('sha256');
  h.update(String(waveIndex));
  h.update('|');
  if (assignment.kind === 'parallel-bucket') {
    h.update('parallel:');
    h.update(String(assignment.index));
  } else {
    h.update('seq-after:');
    h.update(assignment.predecessorBucketId);
  }
  h.update('|');
  // Sorted to keep the id invariant under within-bucket order.
  h.update(ticketIds.slice().sort().join(','));
  return `bk-${h.digest('hex').slice(0, 12)}`;
}

/** Pre-flight check: ticket-id uniqueness + ticket count > 0. */
function validateInput(tickets: readonly Ticket[]): void {
  if (tickets.length === 0) return; // empty is legal (degenerates to no waves)
  const seen = new Set<string>();
  for (const t of tickets) {
    if (seen.has(t.ticketId)) {
      throw new Error(`bucketer: duplicate ticketId ${t.ticketId}`);
    }
    seen.add(t.ticketId);
  }
}

/**
 * Detect resource-lock conflicts within a single level's ticket list.
 * Returns a parallel-eligible array + a sequential-eligible array.
 *
 * Strategy: scan in input order, claim each ticket's resource locks; if a
 * lock is already taken, the ticket is pushed to the sequential bucket.
 * Deterministic given input order.
 */
function splitByResourceConflict(
  ticketsInLevel: readonly string[],
  nodes: ReadonlyMap<string, Ticket>,
): { parallelEligible: string[]; sequential: string[] } {
  const claimed = new Set<string>();
  const parallelEligible: string[] = [];
  const sequential: string[] = [];
  for (const id of ticketsInLevel) {
    const t = nodes.get(id);
    const locks = t?.resourceLocks ?? [];
    let conflict = false;
    for (const lock of locks) {
      if (claimed.has(lock)) {
        conflict = true;
        break;
      }
    }
    if (conflict) {
      sequential.push(id);
    } else {
      for (const lock of locks) claimed.add(lock);
      parallelEligible.push(id);
    }
  }
  return { parallelEligible, sequential };
}

/** Chunk an array into shards of length <= cap. */
function chunk<T>(items: readonly T[], cap: number): T[][] {
  if (cap <= 0) throw new Error('chunk: cap must be > 0');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += cap) {
    out.push(items.slice(i, i + cap));
  }
  return out;
}

/**
 * Run the bucketer.
 *
 * Returns a WavePlan whose buckets are sorted by (waveIndex, bucketId).
 *
 * Throws if the input graph has a cycle. Callers should run detectCycles
 * first to surface a structured cycle report to the operator before
 * attempting to schedule.
 */
export function bucketTickets(input: BucketInput): WavePlan {
  validateInput(input.tickets);
  const perWaveCap = resolvePerWaveCap(input.tenantTier, input.tenantOverrideCap);

  if (input.tickets.length === 0) {
    return Object.freeze({
      buckets: Object.freeze([] as readonly WaveBucket[]),
      waveCount: 0,
      perWaveCap,
    });
  }

  const graph = buildDependencyGraph(input.tickets);
  const levels = topoLevels(graph);
  const byLevel = groupByLevel(levels);

  // Honour SPS conflict-check default — currently advisory; the resource-
  // conflict check above is always applied. Kept for forward-compat with
  // SPS policy evolution.
  const policies = input.bucketPolicies ?? DEFAULT_BUCKET_POLICIES;
  // Read once for side-effect-free access (forward compat hook).
  void policies.global?.conflictCheckDefault;

  const buckets: WaveBucket[] = [];

  // Track the next free wave index. Sequential-after tickets get pushed
  // to currentWaveIndex + 1 (relative to their predecessor bucket).
  let nextWaveIndex = 0;
  const levelKeys = Array.from(byLevel.keys()).sort((a, b) => a - b);

  // Map of "deferred to a later wave" tickets, keyed by waveIndex.
  const deferredByWave = new Map<number, { ticketIds: string[]; predecessorBucketId: string }>();

  for (const lvl of levelKeys) {
    const ticketsInLevel = byLevel.get(lvl) ?? [];
    const { parallelEligible, sequential } = splitByResourceConflict(
      ticketsInLevel,
      graph.nodes,
    );

    const waveIndex = nextWaveIndex;
    // Shard parallel-eligible into parallel-bucket-N up to cap.
    const shards = chunk(parallelEligible, perWaveCap);
    let firstParallelBucketId: string | null = null;
    shards.forEach((shard, idx) => {
      const assignment: BucketKind = { kind: 'parallel-bucket', index: idx };
      const id = bucketIdOf(waveIndex, assignment, shard);
      buckets.push(
        Object.freeze({
          bucketId: id,
          waveIndex,
          assignment: Object.freeze(assignment),
          ticketIds: Object.freeze(shard.slice()),
        }),
      );
      if (firstParallelBucketId === null) firstParallelBucketId = id;
    });

    // Deferred (from earlier conflicts at this level)
    const deferredHere = deferredByWave.get(waveIndex);
    if (deferredHere && deferredHere.ticketIds.length > 0) {
      const deferredShards = chunk(deferredHere.ticketIds, perWaveCap);
      deferredShards.forEach((shard) => {
        const assignment: BucketKind = {
          kind: 'sequential-after',
          predecessorBucketId: deferredHere.predecessorBucketId,
        };
        const id = bucketIdOf(waveIndex, assignment, shard);
        buckets.push(
          Object.freeze({
            bucketId: id,
            waveIndex,
            assignment: Object.freeze(assignment),
            ticketIds: Object.freeze(shard.slice()),
          }),
        );
      });
      deferredByWave.delete(waveIndex);
    }

    // Sequential conflicts at this level get pushed to the next wave,
    // anchored to the first parallel bucket from this wave.
    if (sequential.length > 0) {
      const anchor =
        firstParallelBucketId ??
        (deferredHere?.predecessorBucketId ?? `level-${lvl}-no-anchor`);
      const targetWave = waveIndex + 1;
      const existing = deferredByWave.get(targetWave);
      if (existing) {
        existing.ticketIds.push(...sequential);
      } else {
        deferredByWave.set(targetWave, {
          ticketIds: sequential.slice(),
          predecessorBucketId: anchor,
        });
      }
    }

    nextWaveIndex = waveIndex + 1;
  }

  // Drain any remaining deferred tickets (when conflicts cascade past the
  // last level). We re-apply resource-conflict splitting so that a fully-
  // conflicting set cascades across multiple waves rather than collapsing
  // into one sequential bucket that would itself violate the locks.
  let drainWave = nextWaveIndex;
  let drainGuard = 0;
  const DRAIN_GUARD_MAX = 10_000;
  while (deferredByWave.size > 0) {
    drainGuard += 1;
    if (drainGuard > DRAIN_GUARD_MAX) {
      throw new Error('bucketer: drain loop exceeded ' + DRAIN_GUARD_MAX + ' iterations');
    }
    const nextKey = Math.min(...Array.from(deferredByWave.keys()));
    if (nextKey > drainWave) drainWave = nextKey;
    const entry = deferredByWave.get(drainWave);
    if (!entry) {
      drainWave += 1;
      continue;
    }
    deferredByWave.delete(drainWave);
    const { parallelEligible: drainParallel, sequential: drainSequential } =
      splitByResourceConflict(entry.ticketIds, graph.nodes);
    let firstDrainBucketId: string | null = null;
    const drainShards = chunk(drainParallel, perWaveCap);
    drainShards.forEach((shard) => {
      const assignment: BucketKind = {
        kind: 'sequential-after',
        predecessorBucketId: entry.predecessorBucketId,
      };
      const id = bucketIdOf(drainWave, assignment, shard);
      buckets.push(
        Object.freeze({
          bucketId: id,
          waveIndex: drainWave,
          assignment: Object.freeze(assignment),
          ticketIds: Object.freeze(shard.slice()),
        }),
      );
      if (firstDrainBucketId === null) firstDrainBucketId = id;
    });
    if (drainSequential.length > 0) {
      const anchor = firstDrainBucketId ?? entry.predecessorBucketId;
      const targetWave = drainWave + 1;
      const existing = deferredByWave.get(targetWave);
      if (existing) {
        existing.ticketIds.push(...drainSequential);
      } else {
        deferredByWave.set(targetWave, {
          ticketIds: drainSequential.slice(),
          predecessorBucketId: anchor,
        });
      }
    }
    drainWave += 1;
  }

  buckets.sort((a, b) => {
    if (a.waveIndex !== b.waveIndex) return a.waveIndex - b.waveIndex;
    return a.bucketId.localeCompare(b.bucketId);
  });

  const waveCount = buckets.length === 0 ? 0 : buckets[buckets.length - 1]!.waveIndex + 1;
  return Object.freeze({
    buckets: Object.freeze(buckets),
    waveCount,
    perWaveCap,
  });
}

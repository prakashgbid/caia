/**
 * Bucket placement decider — assigns enriched stories (tickets) into either:
 *   • a sequential-per-domain bucket, when the story has cross-domain
 *     upstream dependencies (or when the prompt-level bucket plan calls for
 *     domain-bounded sequencing), or
 *   • a parallel bucket, when the story has no cross-domain upstream
 *     dependencies and can run alongside other independent stories.
 *
 * Buckets are scoped per prompt: each prompt gets its own set of sequential
 * buckets (one per active domain) and at most one parallel bucket.
 *
 * The decider reads:
 *   • `stories.dependsOnJson` — story-level dependency graph
 *   • `entity_labels` (label_type='domain') — primary domain per story
 *
 * It writes:
 *   • `task_buckets` — creates / re-uses bucket rows for the prompt
 *   • `stories.bucket_id` — links each story to its bucket
 *   • One `task-scheduler.bucket-placed` event per story
 *   • One `task-scheduler.scheduling.complete` event after the round
 */

import { eq, and } from 'drizzle-orm';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';
import { entityLabels, stories, taskBuckets } from '../db/schema';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlacementInput {
  promptId: string;
  correlationId: string;
}

export interface BucketPlacement {
  storyId: string;
  bucketId: string;
  bucketKind: 'sequential' | 'parallel';
  domainSlug: string | null;
  positionInBucket: number;
}

export interface PlacementOutput {
  promptId: string;
  placements: BucketPlacement[];
  sequentialBucketsCreated: number;
  parallelBucketSize: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((d): d is string => typeof d === 'string')
      : [];
  } catch {
    return [];
  }
}

/**
 * Read the primary domain for a story. Tries entity_labels first (label_type
 * = 'domain', highest confidence wins), falls back to the first entry in
 * `domain_slugs_json`, then to the literal 'general'.
 */
function readPrimaryDomain(db: Db, storyId: string, domainSlugsJson: string): string {
  const labels = db
    .select()
    .from(entityLabels)
    .where(
      and(
        eq(entityLabels.entityKind, 'story'),
        eq(entityLabels.entityId, storyId),
        eq(entityLabels.labelType, 'domain'),
      ),
    )
    .all();
  if (labels.length > 0) {
    // Highest-confidence domain label wins; ties broken by createdAt asc.
    const sorted = [...labels].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0) || a.createdAt - b.createdAt,
    );
    return sorted[0]!.labelSlug;
  }
  const fallback = safeParseStringArray(domainSlugsJson)[0];
  return fallback ?? 'general';
}

/** Format a sequential-bucket id once we know the domain + sequence index. */
function sequentialBucketId(domainSlug: string, sequenceIndex: number): string {
  return `bkt_seq_${domainSlug}_${sequenceIndex.toString().padStart(3, '0')}`;
}

function parallelBucketId(promptId: string): string {
  return `bkt_par_${promptId}`;
}

// ─── Topological sort (Kahn's algorithm, reused) ─────────────────────────────

function topologicallySort(
  ids: string[],
  deps: Map<string, string[]>,
): string[] {
  const nodeSet = new Set(ids);
  const inDegree = new Map<string, number>();
  for (const id of ids) {
    const upstream = (deps.get(id) ?? []).filter((d) => nodeSet.has(d));
    inDegree.set(id, upstream.length);
  }

  const visited = new Set<string>();
  const order: string[] = [];
  let frontier = ids.filter((id) => (inDegree.get(id) ?? 0) === 0);
  while (frontier.length > 0) {
    frontier.sort();
    for (const id of frontier) {
      if (visited.has(id)) continue;
      order.push(id);
      visited.add(id);
    }
    const next: string[] = [];
    for (const id of ids) {
      if (visited.has(id)) continue;
      const unresolved = (deps.get(id) ?? []).filter(
        (d) => nodeSet.has(d) && !visited.has(d),
      );
      if (unresolved.length === 0) next.push(id);
    }
    frontier = [...new Set(next)];
  }
  // Append any orphans (cycle members) in stable id order.
  for (const id of ids) if (!visited.has(id)) order.push(id);
  return order;
}

// ─── Bucket lookup / creation ────────────────────────────────────────────────

function findOrCreateSequentialBucket(
  db: Db,
  promptId: string,
  domainSlug: string,
): {
  id: string;
  sequenceIndex: number;
  created: boolean;
} {
  const existing = db
    .select()
    .from(taskBuckets)
    .where(
      and(
        eq(taskBuckets.promptId, promptId),
        eq(taskBuckets.kind, 'sequential'),
        eq(taskBuckets.domainSlug, domainSlug),
      ),
    )
    .get();
  if (existing) {
    return { id: existing.id, sequenceIndex: existing.sequenceIndex ?? 0, created: false };
  }

  // Determine the next sequence_index by scanning all sequential buckets for
  // this prompt — keeps ordering deterministic across domains.
  const allSeq = db
    .select()
    .from(taskBuckets)
    .where(
      and(eq(taskBuckets.promptId, promptId), eq(taskBuckets.kind, 'sequential')),
    )
    .all();
  const maxIdx = allSeq.reduce(
    (acc, b) => Math.max(acc, b.sequenceIndex ?? -1),
    -1,
  );
  const nextIdx = maxIdx + 1;
  const id = sequentialBucketId(domainSlug, nextIdx);
  db.insert(taskBuckets)
    .values({
      id,
      kind: 'sequential',
      domainSlug,
      promptId,
      createdAt: Date.now(),
      sequenceIndex: nextIdx,
      status: 'open',
    })
    .run();
  return { id, sequenceIndex: nextIdx, created: true };
}

function findOrCreateParallelBucket(
  db: Db,
  promptId: string,
): { id: string; created: boolean } {
  const id = parallelBucketId(promptId);
  const existing = db
    .select()
    .from(taskBuckets)
    .where(eq(taskBuckets.id, id))
    .get();
  if (existing) return { id: existing.id, created: false };
  db.insert(taskBuckets)
    .values({
      id,
      kind: 'parallel',
      domainSlug: null,
      promptId,
      createdAt: Date.now(),
      sequenceIndex: null,
      status: 'open',
    })
    .run();
  return { id, created: true };
}

// ─── Main entry point ────────────────────────────────────────────────────────

/**
 * Place every story under the supplied prompt into the correct bucket.
 *
 * Returns the placement list plus aggregate counts. Idempotent: re-running
 * for the same prompt re-uses existing buckets (sequential bucket per
 * domain + at most one parallel bucket) and updates story.bucket_id.
 */
export function placeStoriesInBuckets(
  input: PlacementInput,
  db: Db,
): PlacementOutput {
  const { promptId, correlationId } = input;

  const allStories = db
    .select()
    .from(stories)
    .where(eq(stories.rootPromptId, promptId))
    .all();
  if (allStories.length === 0) {
    return {
      promptId,
      placements: [],
      sequentialBucketsCreated: 0,
      parallelBucketSize: 0,
    };
  }

  // 1. Compute primary domain for every story.
  const storyDomain = new Map<string, string>();
  for (const story of allStories) {
    storyDomain.set(story.id, readPrimaryDomain(db, story.id, story.domainSlugsJson ?? '[]'));
  }

  // 2. Build dependency graph from stories.dependsOnJson.
  const depGraph = new Map<string, string[]>();
  for (const story of allStories) {
    depGraph.set(story.id, safeParseStringArray(story.dependsOnJson));
  }

  // 3. Decide bucket kind for each story per the Phase-1 directive:
  //    a story goes to a sequential-per-domain bucket iff at least one of
  //    its upstream stories sits in a *different* primary domain. Otherwise
  //    (no upstream, or only same-domain upstream) it goes to the prompt's
  //    single parallel bucket; the executor still honours intra-bucket
  //    dependsOn ordering for same-domain dependencies.
  const placements: BucketPlacement[] = [];
  const sequentialDomainsTouched = new Set<string>();
  let parallelCount = 0;

  // Buffer placements per bucket so we can topologically sort within each
  // sequential bucket before persisting positions.
  const sequentialMembers = new Map<string, string[]>();
  const parallelMembers: string[] = [];

  for (const story of allStories) {
    const myDomain = storyDomain.get(story.id) ?? 'general';
    const upstream = depGraph.get(story.id) ?? [];
    const inPrompt = upstream.filter((id) => storyDomain.has(id));

    const hasCrossDomainUpstream = inPrompt.some(
      (upId) => (storyDomain.get(upId) ?? 'general') !== myDomain,
    );

    if (hasCrossDomainUpstream) {
      const list = sequentialMembers.get(myDomain) ?? [];
      list.push(story.id);
      sequentialMembers.set(myDomain, list);
      sequentialDomainsTouched.add(myDomain);
    } else {
      // No upstream stories within this prompt — eligible for parallel bucket.
      parallelMembers.push(story.id);
    }
  }

  // 4. Materialise sequential buckets and persist placements (sorted topo).
  let sequentialBucketsCreated = 0;
  for (const [domain, ids] of sequentialMembers) {
    const sortedIds = topologicallySort(ids, depGraph);
    const { id: bucketId, sequenceIndex, created } = findOrCreateSequentialBucket(
      db,
      promptId,
      domain,
    );
    if (created) sequentialBucketsCreated++;

    for (let i = 0; i < sortedIds.length; i++) {
      const storyId = sortedIds[i]!;
      db.update(stories).set({ bucketId }).where(eq(stories.id, storyId)).run();
      placements.push({
        storyId,
        bucketId,
        bucketKind: 'sequential',
        domainSlug: domain,
        positionInBucket: i,
      });
      eventBus.publish({
        type: 'task-scheduler.bucket-placed',
        actor: 'task-scheduler',
        correlation_id: correlationId,
        entity_type: 'story',
        entity_id: storyId,
        payload: {
          promptId,
          correlationId,
          storyId,
          bucketId,
          bucketKind: 'sequential',
          domainSlug: domain,
          positionInBucket: i,
          sequenceIndex,
        },
      });
    }
  }

  // 5. Materialise the parallel bucket if any story qualifies.
  if (parallelMembers.length > 0) {
    const { id: bucketId } = findOrCreateParallelBucket(db, promptId);
    parallelCount = parallelMembers.length;
    // Stable ordering inside the parallel bucket is unnecessary, but assigning
    // a deterministic positionInBucket aids debugging / dashboard rendering.
    parallelMembers.sort();
    for (let i = 0; i < parallelMembers.length; i++) {
      const storyId = parallelMembers[i]!;
      db.update(stories).set({ bucketId }).where(eq(stories.id, storyId)).run();
      placements.push({
        storyId,
        bucketId,
        bucketKind: 'parallel',
        domainSlug: null,
        positionInBucket: i,
      });
      eventBus.publish({
        type: 'task-scheduler.bucket-placed',
        actor: 'task-scheduler',
        correlation_id: correlationId,
        entity_type: 'story',
        entity_id: storyId,
        payload: {
          promptId,
          correlationId,
          storyId,
          bucketId,
          bucketKind: 'parallel',
          domainSlug: null,
          positionInBucket: i,
        },
      });
    }
  }

  return {
    promptId,
    placements,
    sequentialBucketsCreated,
    parallelBucketSize: parallelCount,
  };
}

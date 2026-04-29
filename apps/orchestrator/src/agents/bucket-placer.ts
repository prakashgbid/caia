/**
 * Bucket placement decider — BUCKET-004 (replaces legacy (prompt, domain)
 * keying with the proposal §9.2 hybrid algorithm).
 *
 * Scheduling model:
 *   1. Static partition by (project_slug, tech_sub_domain_primary)
 *      defines bucket boundaries for resource non-overlap guarantees.
 *      Falls back to (project_slug, domain_slug) for legacy stories that
 *      haven't been re-classified by EA yet.
 *   2. Inside each bucket, the chain-fragmenter (BUCKET-008) computes
 *      level-scheduled batches per weakly-connected component. Levels are
 *      persisted into task_buckets.levels_json.
 *   3. Stories with no blockers AND no in-flight claim conflicts go into
 *      a per-prompt parallel bucket (preserves the previous behavior for
 *      truly-independent work).
 *   4. The resource-claim checker (BUCKET-009) is invoked at placement
 *      time as a WARNING (not a placement-blocker) — actual blocking
 *      happens at executor pickup time via the ready pool.
 *
 * Inputs:
 *   - stories.depends_on_json (existing) AND blocked_by_json (BUCKET-001)
 *     are merged for blocker detection.
 *   - stories.project_slug + stories.tech_sub_domain_primary (BUCKET-001
 *     populated by PO+EA) drive the bucket key.
 *   - stories.claims_json (BUCKET-001 + BUCKET-003) drives the warning.
 *
 * Outputs:
 *   - task_buckets rows keyed by (prompt_id, project_slug, tech_sub_domain).
 *   - stories.bucket_id linked to bucket.
 *   - Events:
 *       task-scheduler.bucket-placed                    (per story)
 *       task-scheduler.cycle-detected                   (per cycle)
 *       task-scheduler.cross-bucket-blocker             (per warning)
 *       task-scheduler.resource-conflict-warning        (per warning)
 *       task-scheduler.wcc-detected                     (per WCC)
 *       task-scheduler.scheduling.complete              (per prompt)
 */

import { eq, and } from 'drizzle-orm';
import { eventBus } from '../events/bus-adapter';
import type { Db } from '../db/connection';
import { stories, taskBuckets } from '../db/schema';
import {
  fragmentChains,
  type FragmentInput,
  type WCC,
} from '../scheduling/chain-fragmenter';
import { checkClaimsConflict, parseClaims } from '../scheduling/resource-claim-checker';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PlacementInput {
  promptId: string;
  correlationId: string;
}

export interface BucketPlacement {
  storyId: string;
  bucketId: string;
  bucketKind: 'sequential' | 'parallel';
  /** (project_slug, tech_sub_domain) for sequential; null/null for parallel. */
  projectSlug: string | null;
  techSubDomain: string | null;
  /** Legacy field — kept for back-compat with consumers. */
  domainSlug: string | null;
  /** Position within the bucket (post topological + level sort). */
  positionInBucket: number;
  /** WCC level (0..longestChain-1), null for parallel-bucket stories. */
  level: number | null;
}

export interface PlacementOutput {
  promptId: string;
  placements: BucketPlacement[];
  sequentialBucketsCreated: number;
  parallelBucketSize: number;
  /** Stories whose blockedBy has cycles — surfaced via task-scheduler.cycle-detected. */
  cycleStoryIds: string[];
  /** Stories with cross-bucket blockers — surfaced as warnings. */
  crossBucketBlockerCount: number;
  /** Stories with claim conflicts at placement time — warnings only. */
  resourceConflictWarnings: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeParseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Compute the bucket key for a story. Prefer (project_slug, tech_sub_domain_primary)
 * (the BUCKET-001/003 model). Fall back to (project_slug ?? 'unassigned',
 * domain_slug ?? 'general') for legacy rows that haven't been EA-classified.
 */
function bucketKey(story: typeof stories.$inferSelect): {
  projectSlug: string;
  techSubDomain: string;
} {
  const projectSlug = story.projectSlug ?? 'unassigned';
  const techSubDomain =
    story.techSubDomainPrimary ??
    safeParseStringArray(story.domainSlugsJson ?? '[]')[0] ??
    'general';
  return { projectSlug, techSubDomain };
}

function sequentialBucketId(
  projectSlug: string,
  techSubDomain: string,
  sequenceIndex: number,
): string {
  return `bkt_seq_${projectSlug}_${techSubDomain}_${sequenceIndex.toString().padStart(3, '0')}`;
}

function parallelBucketId(promptId: string): string {
  return `bkt_par_${promptId}`;
}

// ─── Bucket lookup / creation ────────────────────────────────────────────────

function findOrCreateSequentialBucket(
  db: Db,
  promptId: string,
  projectSlug: string,
  techSubDomain: string,
): { id: string; sequenceIndex: number; created: boolean } {
  const existing = db
    .select()
    .from(taskBuckets)
    .where(
      and(
        eq(taskBuckets.promptId, promptId),
        eq(taskBuckets.kind, 'sequential'),
        eq(taskBuckets.projectSlug, projectSlug),
        eq(taskBuckets.techSubDomain, techSubDomain),
      ),
    )
    .get();
  if (existing) {
    return {
      id: existing.id,
      sequenceIndex: existing.sequenceIndex ?? 0,
      created: false,
    };
  }

  const allSeq = db
    .select()
    .from(taskBuckets)
    .where(and(eq(taskBuckets.promptId, promptId), eq(taskBuckets.kind, 'sequential')))
    .all();
  const maxIdx = allSeq.reduce((acc, b) => Math.max(acc, b.sequenceIndex ?? -1), -1);
  const nextIdx = maxIdx + 1;
  const id = sequentialBucketId(projectSlug, techSubDomain, nextIdx);

  db.insert(taskBuckets)
    .values({
      id,
      kind: 'sequential',
      projectSlug,
      techSubDomain,
      // domain_slug retained as alias for legacy consumers.
      domainSlug: techSubDomain,
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
  const existing = db.select().from(taskBuckets).where(eq(taskBuckets.id, id)).get();
  if (existing) return { id: existing.id, created: false };
  db.insert(taskBuckets)
    .values({
      id,
      kind: 'parallel',
      domainSlug: null,
      projectSlug: null,
      techSubDomain: null,
      promptId,
      createdAt: Date.now(),
      sequenceIndex: null,
      status: 'open',
    })
    .run();
  return { id, created: true };
}

// ─── Cross-bucket blocker detection ─────────────────────────────────────────

interface StoryKeyMap {
  storyToKey: Map<string, string>;
}

function buildStoryKeyMap(allStories: Array<typeof stories.$inferSelect>): StoryKeyMap {
  const storyToKey = new Map<string, string>();
  for (const s of allStories) {
    const k = bucketKey(s);
    storyToKey.set(s.id, `${k.projectSlug}::${k.techSubDomain}`);
  }
  return { storyToKey };
}

function countCrossBucketBlockers(
  story: typeof stories.$inferSelect,
  blockers: string[],
  keys: StoryKeyMap,
): number {
  const myKey = keys.storyToKey.get(story.id);
  if (!myKey) return 0;
  return blockers.filter((bid) => {
    const otherKey = keys.storyToKey.get(bid);
    return otherKey && otherKey !== myKey;
  }).length;
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Place every story under the supplied prompt into the correct bucket using
 * the BUCKET-004 hybrid algorithm. Idempotent: re-running for the same
 * prompt re-uses existing buckets (keyed on (project_slug, tech_sub_domain))
 * and rewrites story.bucket_id in deterministic order.
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
      cycleStoryIds: [],
      crossBucketBlockerCount: 0,
      resourceConflictWarnings: 0,
    };
  }

  // 1. Group by bucket key (project, tech_sub_domain).
  const groups = new Map<string, typeof allStories>();
  for (const s of allStories) {
    const k = bucketKey(s);
    const key = `${k.projectSlug}::${k.techSubDomain}`;
    const arr = groups.get(key) ?? [];
    arr.push(s);
    groups.set(key, arr);
  }

  const keyMap = buildStoryKeyMap(allStories);

  // 2. Build the merged blocker map: union of dependsOnJson and blockedByJson.
  const allBlockedBy = new Map<string, string[]>();
  for (const s of allStories) {
    const dependsOn = safeParseStringArray(s.dependsOnJson);
    const blockedBy = safeParseStringArray(s.blockedByJson);
    allBlockedBy.set(s.id, Array.from(new Set([...dependsOn, ...blockedBy])));
  }

  const placements: BucketPlacement[] = [];
  const cycleStoryIds: string[] = [];
  let sequentialBucketsCreated = 0;
  let crossBucketBlockerCount = 0;
  let resourceConflictWarnings = 0;
  const parallelMembers: typeof allStories = [];

  // Decide per-story: sequential bucket if it has any in-prompt blocker;
  // parallel bucket otherwise. (The §9.2 algorithm puts everything in a
  // sequential bucket keyed on (project, tech) — but we preserve the
  // optimization of a single per-prompt parallel bucket for stories with
  // no blockers at all, matching the existing dashboard layout.)
  const sequentialMembersByGroup = new Map<string, typeof allStories>();
  for (const s of allStories) {
    const blockers = allBlockedBy.get(s.id) ?? [];
    const inPrompt = blockers.filter((id) => keyMap.storyToKey.has(id));
    if (inPrompt.length === 0) {
      parallelMembers.push(s);
    } else {
      const k = bucketKey(s);
      const key = `${k.projectSlug}::${k.techSubDomain}`;
      const arr = sequentialMembersByGroup.get(key) ?? [];
      arr.push(s);
      sequentialMembersByGroup.set(key, arr);

      // Surface cross-bucket warnings (proposal §9.4: cross-bucket-blocker).
      const crossCount = countCrossBucketBlockers(s, inPrompt, keyMap);
      if (crossCount > 0) {
        crossBucketBlockerCount += crossCount;
        eventBus.publish({
          type: 'task-scheduler.cross-bucket-blocker',
          actor: 'task-scheduler',
          correlation_id: correlationId,
          entity_type: 'story',
          entity_id: s.id,
          payload: {
            promptId,
            correlationId,
            storyId: s.id,
            crossCount,
          },
        });
      }
    }
  }

  // 3. Materialise sequential buckets with chain-fragmenter level scheduling.
  for (const [key, members] of sequentialMembersByGroup) {
    const [projectSlug, techSubDomain] = key.split('::');
    if (!projectSlug || !techSubDomain) continue;

    const fragInput: FragmentInput = {
      storyIds: members.map((m) => m.id),
      blockedBy: new Map(members.map((m) => [m.id, allBlockedBy.get(m.id) ?? []])),
    };
    const fragResult = fragmentChains(fragInput);

    if (fragResult.cycleStoryIds.length > 0) {
      cycleStoryIds.push(...fragResult.cycleStoryIds);
      eventBus.publish({
        type: 'task-scheduler.cycle-detected',
        actor: 'task-scheduler',
        correlation_id: correlationId,
        entity_type: 'prompt',
        entity_id: promptId,
        payload: {
          promptId,
          correlationId,
          projectSlug,
          techSubDomain,
          cycleStoryIds: fragResult.cycleStoryIds,
        },
      });
    }

    const {
      id: bucketId,
      sequenceIndex,
      created,
    } = findOrCreateSequentialBucket(db, promptId, projectSlug, techSubDomain);
    if (created) sequentialBucketsCreated++;

    // Persist levels into task_buckets.levels_json.
    const allLevels = fragResult.wccs.flatMap((w) => w.levels);
    db.update(taskBuckets)
      .set({ levelsJson: JSON.stringify(allLevels) })
      .where(eq(taskBuckets.id, bucketId))
      .run();

    // Emit one wcc-detected event per WCC.
    for (let wccIdx = 0; wccIdx < fragResult.wccs.length; wccIdx++) {
      const wcc = fragResult.wccs[wccIdx]!;
      eventBus.publish({
        type: 'task-scheduler.wcc-detected',
        actor: 'task-scheduler',
        correlation_id: correlationId,
        entity_type: 'prompt',
        entity_id: promptId,
        payload: {
          promptId,
          correlationId,
          bucketId,
          wccIndex: wccIdx,
          storyIds: wcc.storyIds,
          longestChain: wcc.longestChain,
          levelCount: wcc.levels.length,
        },
      });
    }

    // Walk WCCs / levels in order; assign positions.
    let position = 0;
    for (const wcc of fragResult.wccs) {
      for (let level = 0; level < wcc.levels.length; level++) {
        for (const storyId of wcc.levels[level]!) {
          db.update(stories).set({ bucketId }).where(eq(stories.id, storyId)).run();
          placements.push({
            storyId,
            bucketId,
            bucketKind: 'sequential',
            projectSlug,
            techSubDomain,
            domainSlug: techSubDomain,
            positionInBucket: position++,
            level,
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
              projectSlug,
              techSubDomain,
              domainSlug: techSubDomain,
              positionInBucket: position - 1,
              sequenceIndex,
              level,
            },
          });
        }
      }
    }
  }

  // 4. Materialise the parallel bucket.
  if (parallelMembers.length > 0) {
    const { id: bucketId } = findOrCreateParallelBucket(db, promptId);
    parallelMembers.sort((a, b) => a.id.localeCompare(b.id));

    // Resource-conflict warning at placement time (warn-only — enforcement
    // happens at executor pickup via ready-pool).
    const inFlightClaims = parallelMembers.map((s) => ({
      id: s.id,
      claims: parseClaims(s.claimsJson),
    }));
    for (let i = 0; i < parallelMembers.length; i++) {
      const candidate = parallelMembers[i]!;
      const peers = inFlightClaims.filter((p) => p.id !== candidate.id);
      const conflict = checkClaimsConflict(
        { id: candidate.id, claims: parseClaims(candidate.claimsJson) },
        peers,
      );
      if (conflict.conflict) {
        resourceConflictWarnings++;
        eventBus.publish({
          type: 'task-scheduler.resource-conflict-warning',
          actor: 'task-scheduler',
          correlation_id: correlationId,
          entity_type: 'story',
          entity_id: candidate.id,
          payload: {
            promptId,
            correlationId,
            storyId: candidate.id,
            blockerStoryId: conflict.blockerStoryId,
            overlappingFiles: conflict.overlappingFiles,
            overlappingSchemas: conflict.overlappingSchemas,
            overlappingApiRoutes: conflict.overlappingApiRoutes,
          },
        });
      }

      db.update(stories).set({ bucketId }).where(eq(stories.id, candidate.id)).run();
      placements.push({
        storyId: candidate.id,
        bucketId,
        bucketKind: 'parallel',
        projectSlug: null,
        techSubDomain: null,
        domainSlug: null,
        positionInBucket: i,
        level: null,
      });
      eventBus.publish({
        type: 'task-scheduler.bucket-placed',
        actor: 'task-scheduler',
        correlation_id: correlationId,
        entity_type: 'story',
        entity_id: candidate.id,
        payload: {
          promptId,
          correlationId,
          storyId: candidate.id,
          bucketId,
          bucketKind: 'parallel',
          projectSlug: null,
          techSubDomain: null,
          domainSlug: null,
          positionInBucket: i,
          level: null,
        },
      });
    }
  }

  return {
    promptId,
    placements,
    sequentialBucketsCreated,
    parallelBucketSize: parallelMembers.length,
    cycleStoryIds: Array.from(new Set(cycleStoryIds)),
    crossBucketBlockerCount,
    resourceConflictWarnings,
  };
}

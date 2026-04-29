/**
 * ReadyPoolConsumer — TASKMGR-003 unit tests.
 *
 * Verifies the consumer's three responsibilities:
 *   1. Snapshots stories + ready-pool recompute.
 *   2. Picks a compatible idle worker (capabilities match the story's bucket).
 *   3. Atomically assigns: worker.status=busy AND story.assignedWorkerId=set,
 *      both inside one SQLite transaction so a parallel pump can't double-assign.
 *
 * 8 cases + 1 integration round-trip with the BUCKET-009 ready-pool helper.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, workerPool, taskBuckets, prompts } from '../../src/db/schema';
import { WorkerPoolRegistry } from '../../src/agents/worker-pool-registry';
import { ReadyPoolConsumer } from '../../src/agents/ready-pool-consumer';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  const registry = new WorkerPoolRegistry(db, { silent: true });
  const consumer = new ReadyPoolConsumer(db, registry, { silent: true });
  // Seed a prompt + a default bucket so FK constraints on stories.bucket_id
  // pass for the synthetic story rows we insert below.
  db.insert(prompts).values({
    id: 'p_test',
    body: 'test',
    receivedAt: new Date().toISOString(),
    correlationId: 'corr_test',
    hash: 'h_test',
  }).run();
  for (const bid of ['bkt_default', 'bkt_a', 'bkt_b', 'bkt_x']) {
    db.insert(taskBuckets).values({
      id: bid,
      kind: 'parallel',
      promptId: 'p_test',
      createdAt: Date.now(),
      status: 'open',
    }).run();
  }
  return { db, registry, consumer };
}

function insertStory(
  db: ReturnType<typeof setup>['db'],
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const now = Date.now();
  db.insert(stories)
    .values({
      id,
      title: id,
      description: '',
      expectedBehavior: '',
      acceptanceCriteriaJson: '[]',
      verificationPlanJson: '[]',
      dependsOnJson: '[]',
      domainSlugsJson: '[]',
      status: 'pending',
      createdAt: String(now),
      agentContributionsJson: '{}',
      templateVersion: 'v1',
      templateValidationStatus: 'pending',
      businessSubDomainsJson: '[]',
      techSubDomainsJson: '[]',
      qualityTagsJson: '[]',
      blockedByJson: '[]',
      softDependsOnJson: '[]',
      conflictsWithJson: '[]',
      claimsJson: '{}',
      inputDependenciesJson: '[]',
      testCasesJson: '[]',
      testDesignStatus: 'pending',
      validationStatus: 'pending',
      validationAttempts: 0,
      linksToJson: '[]',
      architecturalInstructionsJson: '[]',
      bucketId: 'bkt_default',
      priorityBucket: 'P2',
      ...overrides,
    })
    .run();
}

describe('ReadyPoolConsumer.pump — empty cases', () => {
  it('no stories → no assignments', async () => {
    const { consumer } = setup();
    const r = await consumer.pump();
    expect(r.assignmentsMade).toEqual([]);
    expect(r.readyButUnassigned).toEqual([]);
    expect(r.readyTotal).toBe(0);
  });

  it('ready stories but no workers → all unassigned', async () => {
    const { db, consumer } = setup();
    insertStory(db, 's1');
    insertStory(db, 's2');
    const r = await consumer.pump();
    expect(r.assignmentsMade).toEqual([]);
    expect(r.readyButUnassigned.sort()).toEqual(['s1', 's2']);
    expect(r.readyTotal).toBe(2);
  });
});

describe('ReadyPoolConsumer.pump — basic assignment', () => {
  it('matches one ready story to one idle worker', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1');
    const w = registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s1');
    expect(r.assignmentsMade[0]!.workerId).toBe('wkr_1');
    // Worker is now busy.
    expect(registry.get(w.id)!.status).toBe('busy');
    // Story has assignedWorkerId set + phase2Status flipped.
    const story = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(story!.assignedWorkerId).toBe('wkr_1');
    expect(story!.phase2Status).toBe('coding_in_progress');
  });

  it('multiple ready stories + multiple workers → 1:1 pairing', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1');
    insertStory(db, 's2');
    insertStory(db, 's3');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    registry.register({ kind: 'coding', id: 'wkr_2' });
    registry.register({ kind: 'coding', id: 'wkr_3' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(3);
    expect(r.readyButUnassigned).toEqual([]);
    const ids = r.assignmentsMade.map((a) => a.workerId).sort();
    expect(ids).toEqual(['wkr_1', 'wkr_2', 'wkr_3']);
  });

  it('fewer workers than ready → tail goes unassigned', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1', { priorityBucket: 'P2' });
    insertStory(db, 's2', { priorityBucket: 'P2' });
    insertStory(db, 's3', { priorityBucket: 'P2' });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.readyButUnassigned).toHaveLength(2);
  });
});

describe('ReadyPoolConsumer.pump — bucket-capability filter', () => {
  it('worker with capabilities=[bkt_a] only takes stories from bkt_a', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_a', { bucketId: 'bkt_a' });
    insertStory(db, 's_b', { bucketId: 'bkt_b' });
    registry.register({ kind: 'coding', id: 'wkr_a', capabilities: ['bkt_a'] });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s_a');
    expect(r.readyButUnassigned).toEqual(['s_b']);
  });

  it('worker with capabilities=[] (any bucket) takes any story', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_x', { bucketId: 'bkt_x' });
    registry.register({ kind: 'coding', id: 'wkr_any', capabilities: [] });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s_x');
  });
});

describe('ReadyPoolConsumer.pump — priority ordering', () => {
  it('P0 stories assigned before P2', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_low', { priorityBucket: 'P3' });
    insertStory(db, 's_top', { priorityBucket: 'P0' });
    insertStory(db, 's_mid', { priorityBucket: 'P1' });
    registry.register({ kind: 'coding', id: 'wkr_only' });  // only one worker
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s_top');
    expect(r.readyButUnassigned.sort()).toEqual(['s_low', 's_mid']);
  });
});

describe('ReadyPoolConsumer.pump — atomic assign / race', () => {
  it('once assigned, story.assignedWorkerId is non-null and excluded from next pump', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    await consumer.pump();
    // Second pump: nothing to do.
    registry.register({ kind: 'coding', id: 'wkr_2' });
    const r2 = await consumer.pump();
    expect(r2.assignmentsMade).toEqual([]);
    expect(r2.readyTotal).toBe(0);  // s1 filtered out by assignedWorkerId IS NULL guard
  });

  it('worker pool integrity — worker bumped to busy, currentStoryId set', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    await consumer.pump();
    const wp = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_1')).get();
    expect(wp!.status).toBe('busy');
    expect(wp!.currentStoryId).toBe('s1');
  });
});

describe('ReadyPoolConsumer.pump — caps + event payload', () => {
  it('respects maxAssignmentsPerPump option', async () => {
    const { db, registry } = setup();
    const consumer = new ReadyPoolConsumer(db, registry, { silent: true, maxAssignmentsPerPump: 2 });
    insertStory(db, 's1');
    insertStory(db, 's2');
    insertStory(db, 's3');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    registry.register({ kind: 'coding', id: 'wkr_2' });
    registry.register({ kind: 'coding', id: 'wkr_3' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(2);
    expect(r.readyButUnassigned).toHaveLength(1);
  });

  it('event hook onBucketPlaced triggers a pump', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.onBucketPlaced({ storyId: 's1', bucketId: 'bkt_default' });
    expect(r.assignmentsMade).toHaveLength(1);
  });

  it('event hook onTaskCompleted triggers a pump', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's1');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.onTaskCompleted({ storyId: 's_other' });
    expect(r.assignmentsMade).toHaveLength(1);
  });
});

describe('ReadyPoolConsumer.pump — defers stories with unfinished blockers', () => {
  it('blocked-by chain unsatisfied → story is not in ready set', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_blocker', { status: 'pending' });
    insertStory(db, 's_blocked', { blockedByJson: JSON.stringify(['s_blocker']) });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s_blocker');
    // s_blocked is deferred (blocked-by) so doesn't appear in ready or unassigned.
    expect(r.readyTotal).toBe(1);
  });
});

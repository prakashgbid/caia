/**
 * ReadyPoolConsumer — RUN-MODES tests (migration 0038).
 *
 * Verifies the consumer's gate that skips worker assignment for
 * stories belonging to a `plan-only` run, while passing through
 * `full` and `test-only` (the latter is the broker's job downstream,
 * not the consumer's).
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
  db.insert(prompts).values({
    id: 'p_test',
    body: 'test',
    receivedAt: new Date().toISOString(),
    correlationId: 'corr_test',
    hash: 'h_test',
  }).run();
  for (const bid of ['bkt_default']) {
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

describe('ReadyPoolConsumer — RUN-MODES gate', () => {
  it('full-mode story with idle worker is assigned', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_full', { runMode: 'full' });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s_full');
  });

  it('plan-only story is NEVER assigned even with an idle worker', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_plan', { runMode: 'plan-only' });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toEqual([]);
    expect(r.readyButUnassigned).toEqual([]);
    expect(r.readyTotal).toBe(0);
    // Worker stays idle.
    expect(registry.get('wkr_1')!.status).toBe('idle');
    // Story stays unassigned (not flipped to coding_in_progress).
    const story = db.select().from(stories).where(eq(stories.id, 's_plan')).get();
    expect(story!.assignedWorkerId).toBeNull();
  });

  it('test-only story IS assigned (broker enforces capability allowlist downstream)', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_test', { runMode: 'test-only' });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
    expect(r.assignmentsMade[0]!.storyId).toBe('s_test');
  });

  it('mixed-mode batch: full + test-only get assigned, plan-only is skipped', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_full', { runMode: 'full' });
    insertStory(db, 's_plan', { runMode: 'plan-only' });
    insertStory(db, 's_test', { runMode: 'test-only' });
    registry.register({ kind: 'coding', id: 'wkr_a' });
    registry.register({ kind: 'coding', id: 'wkr_b' });
    registry.register({ kind: 'coding', id: 'wkr_c' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(2);
    const assignedIds = r.assignmentsMade.map((a) => a.storyId).sort();
    expect(assignedIds).toEqual(['s_full', 's_test']);
    // Plan-only stays untouched.
    const plan = db.select().from(stories).where(eq(stories.id, 's_plan')).get();
    expect(plan!.assignedWorkerId).toBeNull();
  });

  it('plan-only story does not contribute to readyTotal', async () => {
    const { db, consumer } = setup();
    insertStory(db, 's_plan_a', { runMode: 'plan-only' });
    insertStory(db, 's_plan_b', { runMode: 'plan-only' });
    const r = await consumer.pump();
    expect(r.readyTotal).toBe(0);
  });

  it('default run_mode (full) when not explicitly set behaves like full', async () => {
    const { db, registry, consumer } = setup();
    // Don't pass runMode override; the column default is 'full'.
    insertStory(db, 's_default');
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.pump();
    expect(r.assignmentsMade).toHaveLength(1);
  });

  it('plan-only story remains unassigned across multiple pumps', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_plan', { runMode: 'plan-only' });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    await consumer.pump();
    await consumer.pump();
    await consumer.pump();
    const story = db.select().from(stories).where(eq(stories.id, 's_plan')).get();
    expect(story!.assignedWorkerId).toBeNull();
    expect(registry.get('wkr_1')!.status).toBe('idle');
  });

  it('onBucketPlaced for a plan-only story does not assign', async () => {
    const { db, registry, consumer } = setup();
    insertStory(db, 's_plan', { runMode: 'plan-only' });
    registry.register({ kind: 'coding', id: 'wkr_1' });
    const r = await consumer.onBucketPlaced({ storyId: 's_plan', bucketId: 'bkt_default' });
    expect(r.assignmentsMade).toEqual([]);
  });
});

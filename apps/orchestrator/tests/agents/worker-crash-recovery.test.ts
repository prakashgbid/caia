/**
 * WorkerCrashRecovery — HARDEN-001 unit + chaos tests.
 *
 *   Unit cases (handleCrash):
 *     1. requeue: clears assignedWorkerId, increments codingAttempts,
 *        nulls phase2Status, emits task.requeued.
 *     2. escalate: when codingAttempts hits maxAttempts, sets
 *        phase2Status='escalated' and emits phase2.escalated.
 *     3. idempotent: a duplicate worker.crashed for an already-cleaned
 *        story is a no-op (already_clean outcome, no extra mutations).
 *     4. unknown story: outcome='not_found', no event emitted.
 *     5. payload with no lastStoryId: outcome='no_story'.
 *
 *   Chaos integration: a real worker is registered, ReadyPoolConsumer
 *   assigns a story, the worker's heartbeat goes stale, detectStale
 *   flips it to crashed, the WorkerCrashRecovery subscriber rolls the
 *   story back, then a SECOND worker registers and pump() picks the
 *   story up. We assert: same storyId, different workerId, attempt=1.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, prompts, taskBuckets } from '../../src/db/schema';
import { eventBus } from '../../src/events/bus-adapter';
import { WorkerPoolRegistry } from '../../src/agents/worker-pool-registry';
import { ReadyPoolConsumer } from '../../src/agents/ready-pool-consumer';
import {
  WorkerCrashRecovery,
  registerWorkerCrashRecoveryWithPump,
} from '../../src/agents/worker-crash-recovery';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  // Seed a prompt + buckets so FK on stories.bucket_id passes.
  db.insert(prompts).values({
    id: 'p_t',
    body: 't',
    receivedAt: new Date().toISOString(),
    correlationId: 'c_t',
    hash: 'h_t',
  }).run();
  for (const bid of ['bkt_a', 'bkt_b']) {
    db.insert(taskBuckets).values({
      id: bid,
      kind: 'parallel',
      promptId: 'p_t',
      createdAt: Date.now(),
      status: 'open',
    }).run();
  }
  return { db, sqlite };
}

function insertStory(
  db: ReturnType<typeof setup>['db'],
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const now = String(Date.now());
  db.insert(stories).values({
    id,
    title: id,
    description: '',
    expectedBehavior: '',
    acceptanceCriteriaJson: '[]',
    verificationPlanJson: '[]',
    dependsOnJson: '[]',
    domainSlugsJson: '[]',
    status: 'pending',
    createdAt: now,
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
    bucketId: 'bkt_a',
    priorityBucket: 'P2',
    ...overrides,
  } as never).run();
}

describe('WorkerCrashRecovery — handleCrash unit cases', () => {
  it('requeues: clears assignment, increments attempts, emits task.requeued', async () => {
    const { db } = setup();
    insertStory(db, 'st_1', {
      assignedWorkerId: 'wkr_1',
      codingSessionId: 'sess_xyz',
      phase2Status: 'coding_in_progress',
      codingAttempts: 0,
      worktreePath: '/tmp/x',
    });

    const events: Array<{ type: string; payload: unknown }> = [];
    const off = eventBus.subscribe('task.*', (ev) => events.push(ev));
    try {
      const rec = new WorkerCrashRecovery(db, { silent: false });
      const result = await rec.handleCrash({
        workerId: 'wkr_1',
        lastStoryId: 'st_1',
        error: 'heartbeat-stale',
        lastHeartbeatAt: 1000,
        ts: 2000,
      });

      expect(result.outcome).toBe('requeued');
      expect(result.attemptNumber).toBe(1);

      const row = db.select().from(stories).where(eq(stories.id, 'st_1')).get()!;
      expect(row.assignedWorkerId).toBeNull();
      expect(row.codingSessionId).toBeNull();
      expect(row.codingAttempts).toBe(1);
      expect(row.phase2Status).toBeNull();
      // worktreePath is left in place (HARDEN-003 reaper cleans it).
      expect(row.worktreePath).toBe('/tmp/x');

      const requeued = events.find((e) => e.type === 'task.requeued');
      expect(requeued).toBeDefined();
      expect((requeued!.payload as Record<string, unknown>).storyId).toBe('st_1');
    } finally {
      off();
    }
  });

  it('escalates: at maxAttempts, sets phase2Status and emits phase2.escalated', async () => {
    const { db } = setup();
    insertStory(db, 'st_2', {
      assignedWorkerId: 'wkr_2',
      phase2Status: 'coding_in_progress',
      codingAttempts: 2,
    });
    const events: Array<{ type: string }> = [];
    const off = eventBus.subscribe('phase2.*', (ev) => events.push(ev));
    try {
      const rec = new WorkerCrashRecovery(db, { maxCodingAttempts: 3 });
      const result = await rec.handleCrash({
        workerId: 'wkr_2',
        lastStoryId: 'st_2',
        error: 'heartbeat-stale',
        lastHeartbeatAt: 0,
        ts: 0,
      });
      expect(result.outcome).toBe('escalated');
      expect(result.attemptNumber).toBe(3);

      const row = db.select().from(stories).where(eq(stories.id, 'st_2')).get()!;
      expect(row.phase2Status).toBe('escalated');
      expect(row.assignedWorkerId).toBeNull();
      expect(events.find((e) => e.type === 'phase2.escalated')).toBeDefined();
    } finally {
      off();
    }
  });

  it('idempotent: duplicate crash for already-cleaned story is a no-op', async () => {
    const { db } = setup();
    insertStory(db, 'st_3', {
      assignedWorkerId: null,
      phase2Status: null,
      codingAttempts: 1,
    });
    const rec = new WorkerCrashRecovery(db, { silent: true });
    const result = await rec.handleCrash({
      workerId: 'wkr_1',
      lastStoryId: 'st_3',
      error: 'heartbeat-stale',
      lastHeartbeatAt: 0,
      ts: 0,
    });
    expect(result.outcome).toBe('already_clean');
    const row = db.select().from(stories).where(eq(stories.id, 'st_3')).get()!;
    expect(row.codingAttempts).toBe(1);
  });

  it('not_found: returns clean outcome for unknown story', async () => {
    const { db } = setup();
    const rec = new WorkerCrashRecovery(db, { silent: true });
    const result = await rec.handleCrash({
      workerId: 'wkr_x',
      lastStoryId: 'st_ghost',
      error: 'heartbeat-stale',
      lastHeartbeatAt: 0,
      ts: 0,
    });
    expect(result.outcome).toBe('not_found');
  });

  it('no_story: returns no_story when payload.lastStoryId is null', async () => {
    const { db } = setup();
    const rec = new WorkerCrashRecovery(db, { silent: true });
    const result = await rec.handleCrash({
      workerId: 'wkr_1',
      lastStoryId: null,
      error: 'heartbeat-stale',
      lastHeartbeatAt: 0,
      ts: 0,
    });
    expect(result.outcome).toBe('no_story');
  });
});

describe('WorkerCrashRecovery — chaos: kill mid-flight, re-pump picks up', () => {
  it('crashed worker -> story rolled back -> second worker picks it up', async () => {
    let now = 1000;
    const { db } = setup();
    insertStory(db, 'st_chaos', { bucketId: 'bkt_a', phase2Status: null });

    const registry = new WorkerPoolRegistry(db, {
      silent: false,
      staleThresholdMs: 100,
      now: () => now,
    });
    const consumer = new ReadyPoolConsumer(db, registry, { silent: true, now: () => now });

    const { unsubscribe } = registerWorkerCrashRecoveryWithPump(db, consumer, {
      maxCodingAttempts: 3,
    });

    try {
      // Worker A registers, gets the story.
      const a = registry.register({ kind: 'coding', capabilities: ['bkt_a'] });
      const first = await consumer.pump();
      expect(first.assignmentsMade).toHaveLength(1);
      expect(first.assignmentsMade[0]!.workerId).toBe(a.id);

      // Time advances past the stale threshold without A heartbeating.
      now = 1500;
      const evicted = registry.detectStale();
      expect(evicted).toContain(a.id);

      // Recovery runs via the bus subscriber — drain microtasks.
      await new Promise((r) => setImmediate(r));
      let row = db.select().from(stories).where(eq(stories.id, 'st_chaos')).get()!;
      expect(row.assignedWorkerId).toBeNull();
      expect(row.codingAttempts).toBe(1);
      expect(row.phase2Status).toBeNull();

      // Second worker registers; pump() should now assign st_chaos to B.
      const b = registry.register({ kind: 'coding', capabilities: ['bkt_a'] });
      const second = await consumer.pump();
      expect(second.assignmentsMade).toHaveLength(1);
      const assigned = second.assignmentsMade[0]!;
      expect(assigned.storyId).toBe('st_chaos');
      expect(assigned.workerId).toBe(b.id);
      expect(assigned.workerId).not.toBe(a.id);

      row = db.select().from(stories).where(eq(stories.id, 'st_chaos')).get()!;
      expect(row.assignedWorkerId).toBe(b.id);
      expect(row.phase2Status).toBe('coding_in_progress');
    } finally {
      unsubscribe();
    }
  });
});

/**
 * HealthMetricsEmitter — TASKMGR-005 unit tests.
 *
 * Verifies the per-bucket aggregation (queue depth, throughput,
 * oldest-ready age, workers assigned), the persistence to
 * bucket_health_history, and the engaged flag mirroring from
 * a BackpressureMonitor stub.
 *
 * 9 cases.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, asc } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, workerPool, taskBuckets, prompts, events, bucketHealthHistory } from '../../src/db/schema';
import { HealthMetricsEmitter } from '../../src/agents/health-metrics-emitter';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function setup(opts: { now?: () => number; backpressureEngaged?: string[] } = {}) {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  db.insert(prompts).values({
    id: 'p_test',
    body: 'test',
    receivedAt: new Date().toISOString(),
    correlationId: 'corr_test',
    hash: 'h_test',
  }).run();
  for (const bid of ['bkt_a', 'bkt_b']) {
    db.insert(taskBuckets).values({
      id: bid,
      kind: 'parallel',
      promptId: 'p_test',
      createdAt: Date.now(),
      status: 'open',
    }).run();
  }
  const backpressureMonitor = opts.backpressureEngaged
    ? { listEngaged: () => opts.backpressureEngaged! }
    : undefined;
  const emitter = new HealthMetricsEmitter(db, {
    silent: true,
    now: opts.now,
    backpressureMonitor,
  });
  return { db, emitter };
}

function insertStory(
  db: ReturnType<typeof setup>['db'],
  id: string,
  bucketId: string,
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
      bucketId,
      ...overrides,
    })
    .run();
}

describe('HealthMetricsEmitter — discoverBuckets', () => {
  it('returns no metrics when no buckets have stories', () => {
    const { emitter } = setup();
    expect(emitter.emitOnce()).toEqual([]);
  });

  it('returns one metric per distinct bucket_id with at least one story', () => {
    const { db, emitter } = setup();
    insertStory(db, 's_a', 'bkt_a');
    insertStory(db, 's_b1', 'bkt_b');
    insertStory(db, 's_b2', 'bkt_b');
    const metrics = emitter.emitOnce();
    expect(metrics.map((m) => m.bucketId).sort()).toEqual(['bkt_a', 'bkt_b']);
  });
});

describe('HealthMetricsEmitter — queueDepth', () => {
  it('counts only pending + unassigned stories', () => {
    const { db, emitter } = setup();
    insertStory(db, 's1', 'bkt_a');
    insertStory(db, 's2', 'bkt_a');
    insertStory(db, 's3', 'bkt_a', { assignedWorkerId: 'wkr_x' });  // excluded
    insertStory(db, 's4', 'bkt_a', { status: 'verified' });          // excluded
    const m = emitter.emitOnce().find((x) => x.bucketId === 'bkt_a')!;
    expect(m.queueDepth).toBe(2);
  });
});

describe('HealthMetricsEmitter — workersAssigned', () => {
  it('counts busy workers whose currentStoryId is in the bucket', () => {
    const { db, emitter } = setup();
    insertStory(db, 's1', 'bkt_a');
    insertStory(db, 's2', 'bkt_a');
    insertStory(db, 's3', 'bkt_b');
    db.insert(workerPool).values([
      {
        id: 'wkr_1',
        kind: 'coding',
        status: 'busy',
        currentStoryId: 's1',
        capabilitiesJson: '[]',
        lastHeartbeatAt: Date.now(),
        registeredAt: Date.now(),
        metadataJson: '{}',
      },
      {
        id: 'wkr_2',
        kind: 'coding',
        status: 'busy',
        currentStoryId: 's2',
        capabilitiesJson: '[]',
        lastHeartbeatAt: Date.now(),
        registeredAt: Date.now(),
        metadataJson: '{}',
      },
      {
        id: 'wkr_3',
        kind: 'coding',
        status: 'busy',
        currentStoryId: 's3',
        capabilitiesJson: '[]',
        lastHeartbeatAt: Date.now(),
        registeredAt: Date.now(),
        metadataJson: '{}',
      },
      {
        id: 'wkr_4',
        kind: 'coding',
        status: 'idle',
        currentStoryId: null,
        capabilitiesJson: '[]',
        lastHeartbeatAt: Date.now(),
        registeredAt: Date.now(),
        metadataJson: '{}',
      },
    ]).run();
    const metrics = emitter.emitOnce();
    expect(metrics.find((m) => m.bucketId === 'bkt_a')!.workersAssigned).toBe(2);
    expect(metrics.find((m) => m.bucketId === 'bkt_b')!.workersAssigned).toBe(1);
  });
});

describe('HealthMetricsEmitter — oldestReadyAgeS', () => {
  it('returns null when no ready stories', () => {
    const { db, emitter } = setup();
    insertStory(db, 's_assigned', 'bkt_a', { assignedWorkerId: 'wkr_x' });
    const m = emitter.emitOnce().find((x) => x.bucketId === 'bkt_a')!;
    expect(m.oldestReadyAgeS).toBeNull();
  });

  it('computes age in seconds from createdAt to ts', () => {
    const fakeNow = 1_000_000_000_000;
    const { db, emitter } = setup({ now: () => fakeNow });
    // Two stories, oldest at fakeNow - 5000ms
    insertStory(db, 's_old', 'bkt_a', { createdAt: String(fakeNow - 5_000) });
    insertStory(db, 's_new', 'bkt_a', { createdAt: String(fakeNow - 1_000) });
    const m = emitter.emitOnce().find((x) => x.bucketId === 'bkt_a')!;
    expect(m.oldestReadyAgeS).toBe(5);
  });
});

describe('HealthMetricsEmitter — throughputPerHour', () => {
  it('counts task.tested_and_done events for stories in the bucket within 1 hour', () => {
    const fakeNow = 1_000_000_000_000;
    const { db, emitter } = setup({ now: () => fakeNow });
    insertStory(db, 's1', 'bkt_a');
    insertStory(db, 's2', 'bkt_a');
    insertStory(db, 's3', 'bkt_b');
    // Insert events: 2 done in bkt_a within the hour, 1 outside, 1 in bkt_b
    db.insert(events).values([
      {
        id: 'ev_1',
        type: 'task.tested_and_done',
        occurredAt: new Date(fakeNow - 30 * 60 * 1000).toISOString(),
        actor: 'task-scheduler',
        entityId: 's1',
        domainSlugsJson: '[]',
        payloadJson: '{}',
        metadataJson: '{}',
        severity: 'info',
      },
      {
        id: 'ev_2',
        type: 'task.tested_and_done',
        occurredAt: new Date(fakeNow - 50 * 60 * 1000).toISOString(),
        actor: 'task-scheduler',
        entityId: 's2',
        domainSlugsJson: '[]',
        payloadJson: '{}',
        metadataJson: '{}',
        severity: 'info',
      },
      {
        id: 'ev_3',
        type: 'task.tested_and_done',
        occurredAt: new Date(fakeNow - 90 * 60 * 1000).toISOString(),    // outside 1h window
        actor: 'task-scheduler',
        entityId: 's1',
        domainSlugsJson: '[]',
        payloadJson: '{}',
        metadataJson: '{}',
        severity: 'info',
      },
      {
        id: 'ev_4',
        type: 'task.tested_and_done',
        occurredAt: new Date(fakeNow - 10 * 60 * 1000).toISOString(),
        actor: 'task-scheduler',
        entityId: 's3',                                                  // bkt_b
        domainSlugsJson: '[]',
        payloadJson: '{}',
        metadataJson: '{}',
        severity: 'info',
      },
    ]).run();
    const metrics = emitter.emitOnce();
    expect(metrics.find((m) => m.bucketId === 'bkt_a')!.throughputPerHour).toBe(2);
    expect(metrics.find((m) => m.bucketId === 'bkt_b')!.throughputPerHour).toBe(1);
  });
});

describe('HealthMetricsEmitter — engaged flag', () => {
  it('mirrors backpressure monitor when provided', () => {
    const { db, emitter } = setup({ backpressureEngaged: ['bkt_a'] });
    insertStory(db, 's_a', 'bkt_a');
    insertStory(db, 's_b', 'bkt_b');
    const metrics = emitter.emitOnce();
    expect(metrics.find((m) => m.bucketId === 'bkt_a')!.engaged).toBe(true);
    expect(metrics.find((m) => m.bucketId === 'bkt_b')!.engaged).toBe(false);
  });

  it('defaults to false when no backpressure monitor wired', () => {
    const { db, emitter } = setup();
    insertStory(db, 's_a', 'bkt_a');
    const m = emitter.emitOnce()[0]!;
    expect(m.engaged).toBe(false);
  });
});

describe('HealthMetricsEmitter — persistence', () => {
  it('writes one bucket_health_history row per bucket per emitOnce', () => {
    const { db, emitter } = setup();
    insertStory(db, 's_a', 'bkt_a');
    insertStory(db, 's_b', 'bkt_b');
    emitter.emitOnce();
    emitter.emitOnce();
    const rows = db.select().from(bucketHealthHistory).orderBy(asc(bucketHealthHistory.ts)).all();
    expect(rows.length).toBe(4);  // 2 buckets × 2 cycles
    expect(rows.every((r) => ['bkt_a', 'bkt_b'].includes(r.bucketId))).toBe(true);
    const lastA = rows.filter((r) => r.bucketId === 'bkt_a').slice(-1)[0]!;
    expect(lastA.queueDepth).toBe(1);
    expect(lastA.workersAssigned).toBe(0);
  });
});

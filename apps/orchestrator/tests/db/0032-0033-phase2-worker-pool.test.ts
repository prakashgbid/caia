/**
 * Migrations 0032 + 0033 smoke tests — TASKMGR-001 Phase 2 worker-pool
 * runtime state.
 *
 * 0032 adds nullable Phase 2 columns to `stories` so worker assignment,
 * worktree state, PR lifecycle, and retry counters are persisted alongside
 * the rest of the story. 0033 introduces the `worker_pool` table — durable
 * registry of every Coding Agent + Fix-It Test Agent process the Task
 * Manager Agent tracks.
 *
 * These tests verify:
 *   - both migrations apply cleanly to an in-memory DB on top of every
 *     prior migration (0000..0031, which includes ARCH-006's
 *     architectural_instructions_json column on stories)
 *   - the new `stories` columns accept the canonical Phase 2 values
 *   - `worker_pool` accepts every documented kind/status combination,
 *     enforces NOT NULL on the heartbeat field, and indexes the columns
 *     the Task Manager scans every 30s for stale-detection
 *   - the existing `stories` columns from prior migrations remain
 *     functional (regression guard against accidental drop/rename)
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, sql } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, workerPool } from '../../src/db/schema';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

function baseStory(id: string, overrides: Partial<Record<string, unknown>> = {}) {
  const now = Date.now();
  return {
    id,
    title: 'a story',
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
    ...overrides,
  } as const;
}

describe('migration 0032: stories Phase 2 columns', () => {
  it('adds the worker-pool columns with the right defaults', () => {
    const { db } = createTestDb();
    db.insert(stories).values(baseStory('s_default')).run();
    const row = db.select().from(stories).where(eq(stories.id, 's_default')).get();
    expect(row).toBeTruthy();
    // Nullable columns default to null (no value provided).
    expect(row!.assignedWorkerId).toBeNull();
    expect(row!.codingSessionId).toBeNull();
    expect(row!.worktreePath).toBeNull();
    expect(row!.featureBranch).toBeNull();
    expect(row!.prNumber).toBeNull();
    expect(row!.prUrl).toBeNull();
    expect(row!.prState).toBeNull();
    expect(row!.lastCommitSha).toBeNull();
    expect(row!.phase2Status).toBeNull();
    expect(row!.phase2BlockerId).toBeNull();
    // NOT NULL counters default to 0.
    expect(row!.codingAttempts).toBe(0);
    expect(row!.fixAttempts).toBe(0);
  });

  it('accepts the full canonical phase2_status taxonomy', () => {
    const { db } = createTestDb();
    const statuses = [
      'coding_in_progress',
      'coding_complete',
      'testing_in_progress',
      'testing_fixing',
      'tests_passing',
      'done',
      'escalated',
    ];
    statuses.forEach((s, i) => {
      db.insert(stories)
        .values(baseStory(`s_${i}`, { phase2Status: s }))
        .run();
    });
    const rows = db.select().from(stories).all();
    expect(rows.map((r) => r.phase2Status).filter(Boolean).sort()).toEqual(statuses.slice().sort());
  });

  it('accepts the full canonical pr_state taxonomy', () => {
    const { db } = createTestDb();
    const prStates = ['draft', 'open', 'merged', 'closed'];
    prStates.forEach((s, i) => {
      db.insert(stories)
        .values(baseStory(`s_pr_${i}`, { prState: s, prNumber: 100 + i, prUrl: `https://github.com/x/y/pull/${100 + i}` }))
        .run();
    });
    const rows = db.select().from(stories).all();
    expect(rows.map((r) => r.prState).filter(Boolean).sort()).toEqual(prStates.slice().sort());
  });

  it('persists worktree + sha + counters round-trip', () => {
    const { db } = createTestDb();
    db.insert(stories)
      .values(
        baseStory('s_full', {
          assignedWorkerId: 'wkr_abc',
          codingSessionId: 'sess_xyz',
          worktreePath: '/Users/MAC/.caia/worktrees/s_full',
          featureBranch: 'feat/s_full-add-leaderboard',
          prNumber: 482,
          prUrl: 'https://github.com/prakashgbid/caia/pull/482',
          prState: 'open',
          lastCommitSha: 'abcd1234',
          codingAttempts: 1,
          fixAttempts: 3,
          phase2Status: 'testing_fixing',
        }),
      )
      .run();
    const row = db.select().from(stories).where(eq(stories.id, 's_full')).get();
    expect(row!.assignedWorkerId).toBe('wkr_abc');
    expect(row!.codingSessionId).toBe('sess_xyz');
    expect(row!.worktreePath).toBe('/Users/MAC/.caia/worktrees/s_full');
    expect(row!.featureBranch).toBe('feat/s_full-add-leaderboard');
    expect(row!.prNumber).toBe(482);
    expect(row!.prUrl).toBe('https://github.com/prakashgbid/caia/pull/482');
    expect(row!.prState).toBe('open');
    expect(row!.lastCommitSha).toBe('abcd1234');
    expect(row!.codingAttempts).toBe(1);
    expect(row!.fixAttempts).toBe(3);
    expect(row!.phase2Status).toBe('testing_fixing');
  });

  it('creates the Task-Manager-critical indexes', () => {
    const { db } = createTestDb();
    const indexes = db.all(sql`
      SELECT name FROM sqlite_master
      WHERE type='index' AND tbl_name='stories'
    `) as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('story_assigned_worker_idx');
    expect(names).toContain('story_phase2_status_idx');
    expect(names).toContain('story_pr_state_idx');
  });

  it('regression guard — pre-Phase-2 columns still exist (FREG-006 + ARCH-006)', () => {
    const { db } = createTestDb();
    db.insert(stories)
      .values(
        baseStory('s_regression', {
          // FREG-006 columns (0029)
          featureClassification: 'enhance',
          featureClassificationScore: 0.91,
          featureClassificationAt: Date.now(),
          // ARCH-006 columns (0031)
          architecturalInstructionsJson: JSON.stringify([
            { domain: 'frontend', kind: 'reuse', artifactId: 'arch_x' },
          ]),
          eaDecomposedAt: Date.now(),
        }),
      )
      .run();
    const row = db.select().from(stories).where(eq(stories.id, 's_regression')).get();
    expect(row!.featureClassification).toBe('enhance');
    expect(row!.featureClassificationScore).toBeCloseTo(0.91, 2);
    expect(typeof row!.featureClassificationAt).toBe('number');
    expect(JSON.parse(row!.architecturalInstructionsJson)).toEqual([
      { domain: 'frontend', kind: 'reuse', artifactId: 'arch_x' },
    ]);
    expect(typeof row!.eaDecomposedAt).toBe('number');
  });
});

describe('migration 0033: worker_pool registry', () => {
  function workerRow(overrides: Partial<Record<string, unknown>> = {}) {
    const now = Date.now();
    return {
      id: 'wkr_default',
      kind: 'coding',
      capabilitiesJson: '[]',
      status: 'idle',
      currentStoryId: null,
      lastHeartbeatAt: now,
      registeredAt: now,
      releasedAt: null,
      metadataJson: '{}',
      ...overrides,
    } as const;
  }

  it('inserts and reads back a worker row with the documented defaults', () => {
    const { db } = createTestDb();
    db.insert(workerPool).values(workerRow()).run();
    const row = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_default')).get();
    expect(row).toBeTruthy();
    expect(row!.kind).toBe('coding');
    expect(row!.status).toBe('idle');
    expect(row!.capabilitiesJson).toBe('[]');
    expect(row!.metadataJson).toBe('{}');
    expect(row!.currentStoryId).toBeNull();
    expect(row!.releasedAt).toBeNull();
    expect(typeof row!.registeredAt).toBe('number');
    expect(typeof row!.lastHeartbeatAt).toBe('number');
  });

  it('accepts both worker kinds (coding, fix-it)', () => {
    const { db } = createTestDb();
    db.insert(workerPool).values(workerRow({ id: 'wkr_a', kind: 'coding' })).run();
    db.insert(workerPool).values(workerRow({ id: 'wkr_b', kind: 'fix-it' })).run();
    const rows = db.select().from(workerPool).all();
    expect(rows.map((r) => r.kind).sort()).toEqual(['coding', 'fix-it']);
  });

  it('accepts the full canonical status taxonomy', () => {
    const { db } = createTestDb();
    const statuses = ['idle', 'busy', 'crashed', 'released'];
    statuses.forEach((s, i) => {
      db.insert(workerPool).values(workerRow({ id: `wkr_${i}`, status: s })).run();
    });
    const rows = db.select().from(workerPool).all();
    expect(rows.map((r) => r.status).sort()).toEqual(statuses.slice().sort());
  });

  it('persists current_story_id when busy and clears it when idle', () => {
    const { db } = createTestDb();
    db.insert(workerPool)
      .values(workerRow({ id: 'wkr_busy', status: 'busy', currentStoryId: 'story-xyz' }))
      .run();
    db.insert(workerPool)
      .values(workerRow({ id: 'wkr_idle', status: 'idle', currentStoryId: null }))
      .run();
    const busy = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_busy')).get();
    const idle = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_idle')).get();
    expect(busy!.currentStoryId).toBe('story-xyz');
    expect(idle!.currentStoryId).toBeNull();
  });

  it('persists capabilities + metadata as JSON strings', () => {
    const { db } = createTestDb();
    db.insert(workerPool)
      .values(
        workerRow({
          id: 'wkr_caps',
          capabilitiesJson: JSON.stringify(['bkt_a', 'bkt_b']),
          metadataJson: JSON.stringify({ hostname: 'mac', pid: 1234, version: '1.0.0' }),
        }),
      )
      .run();
    const row = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_caps')).get();
    expect(JSON.parse(row!.capabilitiesJson)).toEqual(['bkt_a', 'bkt_b']);
    expect(JSON.parse(row!.metadataJson)).toEqual({ hostname: 'mac', pid: 1234, version: '1.0.0' });
  });

  it('enforces NOT NULL on the heartbeat (stale-detector relies on it)', () => {
    const { db } = createTestDb();
    expect(() =>
      db
        .insert(workerPool)
        .values(workerRow({ id: 'wkr_no_hb', lastHeartbeatAt: null as unknown as number }))
        .run(),
    ).toThrow(/NOT NULL/i);
  });

  it('creates the Task-Manager-critical indexes (status, kind, current_story, heartbeat)', () => {
    const { db } = createTestDb();
    const indexes = db.all(sql`
      SELECT name FROM sqlite_master
      WHERE type='index' AND tbl_name='worker_pool'
    `) as Array<{ name: string }>;
    const names = indexes.map((i) => i.name);
    expect(names).toContain('worker_pool_status_idx');
    expect(names).toContain('worker_pool_kind_idx');
    expect(names).toContain('worker_pool_current_story_idx');
    expect(names).toContain('worker_pool_heartbeat_idx');
  });

  it('id is a primary key (no duplicate worker rows)', () => {
    const { db } = createTestDb();
    db.insert(workerPool).values(workerRow({ id: 'wkr_pk' })).run();
    expect(() => db.insert(workerPool).values(workerRow({ id: 'wkr_pk' })).run()).toThrow(/UNIQUE|PRIMARY/i);
  });

  it('records released_at when worker explicitly shuts down', () => {
    const { db } = createTestDb();
    const now = Date.now();
    db.insert(workerPool)
      .values(workerRow({ id: 'wkr_released', status: 'released', releasedAt: now }))
      .run();
    const row = db.select().from(workerPool).where(eq(workerPool.id, 'wkr_released')).get();
    expect(row!.releasedAt).toBe(now);
  });
});

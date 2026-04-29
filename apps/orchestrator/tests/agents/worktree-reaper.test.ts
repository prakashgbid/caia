/**
 * WorktreeReaper — HARDEN-003 unit tests.
 *
 * Uses a real tmpdir so directory creation / removal is exercised end-
 * to-end (no fs stubs). Each test seeds a fresh story row + on-disk
 * directory and asserts the sweep result.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, prompts, taskBuckets } from '../../src/db/schema';
import { WorktreeReaper } from '../../src/agents/worktree-reaper';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function tmpdir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reaper-'));
  return dir;
}

function setup() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  db.insert(prompts).values({
    id: 'p_t', body: 't', receivedAt: new Date().toISOString(),
    correlationId: 'c_t', hash: 'h_t',
  }).run();
  db.insert(taskBuckets).values({
    id: 'bkt_a', kind: 'parallel', promptId: 'p_t',
    createdAt: Date.now(), status: 'open',
  }).run();
  return { db };
}

function insertStory(
  db: ReturnType<typeof setup>['db'],
  id: string,
  overrides: Partial<Record<string, unknown>> = {},
): void {
  const now = String(Date.now());
  db.insert(stories).values({
    id, title: id, description: '',
    expectedBehavior: '',
    acceptanceCriteriaJson: '[]', verificationPlanJson: '[]',
    dependsOnJson: '[]', domainSlugsJson: '[]',
    status: 'pending', createdAt: now,
    agentContributionsJson: '{}', templateVersion: 'v1',
    templateValidationStatus: 'pending',
    businessSubDomainsJson: '[]', techSubDomainsJson: '[]',
    qualityTagsJson: '[]', blockedByJson: '[]',
    softDependsOnJson: '[]', conflictsWithJson: '[]',
    claimsJson: '{}', inputDependenciesJson: '[]',
    testCasesJson: '[]', testDesignStatus: 'pending',
    validationStatus: 'pending', validationAttempts: 0,
    linksToJson: '[]', architecturalInstructionsJson: '[]',
    bucketId: 'bkt_a', priorityBucket: 'P2',
    ...overrides,
  } as never).run();
}

function mkdir(base: string, name: string): string {
  const p = path.join(base, name);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, 'placeholder.txt'), 'x');
  return p;
}

afterEach(() => {
  // Cleanup any leftover tmpdirs to keep CI tidy.
});

describe('WorktreeReaper.sweep', () => {
  it('reaps a directory whose story is missing from the DB', () => {
    const base = tmpdir();
    mkdir(base, 'st_ghost');
    const { db } = setup();
    const reaper = new WorktreeReaper(db, { baseDir: base, silent: true });
    const r = reaper.sweep();
    expect(r.reaped).toEqual(['st_ghost']);
    expect(fs.existsSync(path.join(base, 'st_ghost'))).toBe(false);
  });

  it('reaps a directory whose story phase2Status is `done`', () => {
    const base = tmpdir();
    mkdir(base, 'st_done');
    const { db } = setup();
    insertStory(db, 'st_done', { phase2Status: 'done' });
    const reaper = new WorktreeReaper(db, { baseDir: base, silent: true });
    const r = reaper.sweep();
    expect(r.reaped).toEqual(['st_done']);
  });

  it('reaps a directory whose story phase2Status is `escalated`', () => {
    const base = tmpdir();
    mkdir(base, 'st_esc');
    const { db } = setup();
    insertStory(db, 'st_esc', { phase2Status: 'escalated' });
    const reaper = new WorktreeReaper(db, { baseDir: base, silent: true });
    const r = reaper.sweep();
    expect(r.reaped).toEqual(['st_esc']);
  });

  it('skips a directory whose story is still assigned to a worker', () => {
    const base = tmpdir();
    mkdir(base, 'st_busy');
    const { db } = setup();
    insertStory(db, 'st_busy', { assignedWorkerId: 'wkr_1', phase2Status: 'coding_in_progress' });
    const reaper = new WorktreeReaper(db, { baseDir: base, silent: true });
    const r = reaper.sweep();
    expect(r.skipped).toEqual(['st_busy']);
    expect(fs.existsSync(path.join(base, 'st_busy'))).toBe(true);
  });

  it('reaps an unassigned orphan once orphanGraceMs has elapsed', () => {
    const base = tmpdir();
    const wtPath = mkdir(base, 'st_orphan');
    const { db } = setup();
    insertStory(db, 'st_orphan', { assignedWorkerId: null });
    // Backdate the directory mtime so the grace window is clearly stale.
    const old = (Date.now() - 20 * 60 * 1000) / 1000;
    fs.utimesSync(wtPath, old, old);
    const reaper = new WorktreeReaper(db, {
      baseDir: base,
      orphanGraceMs: 10 * 60 * 1000,
      silent: true,
    });
    const r = reaper.sweep();
    expect(r.reaped).toEqual(['st_orphan']);
  });

  it('skips an unassigned story whose directory is still inside grace', () => {
    const base = tmpdir();
    mkdir(base, 'st_fresh');
    const { db } = setup();
    insertStory(db, 'st_fresh', { assignedWorkerId: null });
    const reaper = new WorktreeReaper(db, {
      baseDir: base,
      orphanGraceMs: 10 * 60 * 1000,
      silent: true,
    });
    const r = reaper.sweep();
    expect(r.skipped).toEqual(['st_fresh']);
  });

  it('reports an empty result when baseDir does not exist', () => {
    const { db } = setup();
    const reaper = new WorktreeReaper(db, {
      baseDir: '/private/tmp/this-path-does-not-exist-xyz',
      silent: true,
    });
    const r = reaper.sweep();
    expect(r.reaped).toEqual([]);
    expect(r.skipped).toEqual([]);
  });
});

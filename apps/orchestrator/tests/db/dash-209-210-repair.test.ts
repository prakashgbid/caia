/**
 * DASH-208/209/210 — guard the schema-repair migration.
 *
 * The /behavior-tests*, /builds, and /pulse/* routes were returning HTTP 500
 * because three drizzle-defined tables either didn't exist (behavior_tests*,
 * build_runs*) or had a divergent schema (`pulse_runs` was created by an
 * older code path with `run_id PK` and a `raw_json` blob instead of the
 * canonical `id PK / canary_id / canary_elapsed_ms / checks_json /
 * invariants_json / heals_json` shape).
 *
 * Migration 0015 reconciles all three. This test pins:
 *   1. running migrations on a pre-existing DB that already has a wrongly-
 *      shaped pulse_runs table succeeds (no "table already exists" error);
 *   2. after migration, every drizzle table the failing routes touch can be
 *      queried without throwing a "no such column" error.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { behaviorTests, behaviorTestRuns, behaviorTestFailures, buildRuns, buildSteps, buildRetries, pulseRuns } from '../../src/db/schema';
import { desc } from 'drizzle-orm';

describe('DASH-208/209/210 schema repair (migration 0015)', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash-repair-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    resetDb();
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
  });

  it('applies cleanly to a fresh database and creates all repaired tables', () => {
    runMigrations(dbPath);
    const db = getDb(dbPath);

    // Each of these would have thrown SqliteError("no such table") or
    // ("no such column: id") before the repair migration.
    expect(db.select().from(behaviorTests).all()).toEqual([]);
    expect(db.select().from(behaviorTestRuns).all()).toEqual([]);
    expect(db.select().from(behaviorTestFailures).all()).toEqual([]);
    expect(db.select().from(buildRuns).all()).toEqual([]);
    expect(db.select().from(buildSteps).all()).toEqual([]);
    expect(db.select().from(buildRetries).all()).toEqual([]);
    expect(db.select().from(pulseRuns).orderBy(desc(pulseRuns.ranAt)).all()).toEqual([]);
  });

  it('repairs a database whose pulse_runs was created with the divergent legacy schema', () => {
    // Simulate the dev/staging reality: pulse_runs already exists with the
    // older pipeline-pulse schema (run_id PK + raw_json blob).
    const sqlite = new Database(dbPath);
    sqlite.exec(`
      CREATE TABLE pulse_runs (
        run_id TEXT PRIMARY KEY,
        ran_at TEXT NOT NULL,
        outcome TEXT NOT NULL,
        duration_ms INTEGER,
        triggered_by TEXT,
        raw_json TEXT,
        notes TEXT
      );
      INSERT INTO pulse_runs (run_id, ran_at, outcome, duration_ms, triggered_by, raw_json)
      VALUES ('pulse_pre', '2026-04-01T00:00:00Z', 'PASSING', 100, 'legacy', '{}');
    `);
    sqlite.close();

    // Migrations must apply cleanly — 0013 is now CREATE TABLE IF NOT EXISTS
    // (no-op here), and 0015 drops + recreates with the correct schema.
    runMigrations(dbPath);
    const db = getDb(dbPath);

    // Drizzle-shape select would fail with "no such column: id" against the
    // legacy schema; this confirms the column rebuild succeeded.
    const rows = db.select().from(pulseRuns).orderBy(desc(pulseRuns.ranAt)).all();
    expect(rows).toEqual([]);

    // Verify the new schema is present by inserting a canonical row.
    db.insert(pulseRuns).values({
      id: 'pulse_after',
      ranAt: '2026-04-28T00:00:00Z',
      outcome: 'PASSING',
      canaryId: 'canary_x',
      canaryElapsedMs: 1234,
      checksJson: '[]',
      invariantsJson: '[]',
      healsJson: '[]',
      durationMs: 1234,
    }).run();

    const all = db.select().from(pulseRuns).all();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe('pulse_after');
    expect(all[0]?.canaryId).toBe('canary_x');
  });

  it('is idempotent: re-running migrations on a repaired database is a no-op', () => {
    runMigrations(dbPath);
    resetDb();
    // Second run should not throw.
    expect(() => runMigrations(dbPath)).not.toThrow();
    const db = getDb(dbPath);
    expect(db.select().from(pulseRuns).all()).toEqual([]);
    expect(db.select().from(behaviorTests).all()).toEqual([]);
    expect(db.select().from(buildRuns).all()).toEqual([]);
  });
});

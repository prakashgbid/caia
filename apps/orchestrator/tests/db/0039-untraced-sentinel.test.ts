/**
 * Migration 0039 — `untraced` sentinel prompt row regression test.
 *
 * Pre-fix bug: `tasks.root_prompt_id`, `stories.root_prompt_id`,
 * `requirements.root_prompt_id`, and friends all default to the literal
 * string 'untraced'. No `prompts` row with id='untraced' was ever inserted,
 * so KPI2 lineage queries (`SELECT … FROM tasks JOIN prompts ON
 * tasks.root_prompt_id = prompts.id`) silently lost 197 rows. Captured in
 * blocker `blk_kpi2_lineage_fix_proposal_1777193485` and the audit at
 * `Documents/projects/reports/outstanding-tasks-audit-2026-04-30.md`.
 *
 * Migration 0039 inserts the sentinel idempotently. This suite pins:
 *
 *  - the sentinel exists after `migrate(...)`
 *  - it has the canonical shape (id='untraced', status='completed', etc.)
 *  - re-running the migration is a no-op (INSERT OR IGNORE)
 *  - inner-join from a task.root_prompt_id='untraced' lands the sentinel
 *  - lineage queries no longer drop rows
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema';
import { prompts, tasks } from '../../src/db/schema';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function freshDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

describe('Migration 0039 — untraced sentinel prompt (KPI2-001)', () => {
  it('inserts the untraced sentinel prompt row on a fresh DB', () => {
    const { db } = freshDb();
    const row = db.select().from(prompts).where(eq(prompts.id, 'untraced')).get();
    expect(row).toBeDefined();
    expect(row!.id).toBe('untraced');
    expect(row!.status).toBe('completed');
    expect(row!.body).toBe('');
    expect(row!.correlationId).toBe('sentinel-untraced');
  });

  it('marks the sentinel via metadata so queries can filter it out', () => {
    const { db } = freshDb();
    const row = db.select().from(prompts).where(eq(prompts.id, 'untraced')).get();
    expect(row).toBeDefined();
    const meta = JSON.parse(row!.metadataJson) as { sentinel?: boolean };
    expect(meta.sentinel).toBe(true);
  });

  it('is idempotent — re-running the migration does not raise UNIQUE', () => {
    const { db, sqlite } = freshDb();
    // Apply the same migration body a second time — must not throw.
    expect(() =>
      sqlite.exec(`
        INSERT OR IGNORE INTO prompts (id, body, received_at, received_via, correlation_id, hash, metadata_json, status, run_mode)
        VALUES ('untraced', '', '1970-01-01T00:00:00.000Z', 'system', 'sentinel-untraced', 'sentinel-untraced', '{"sentinel":true}', 'completed', 'full');
      `),
    ).not.toThrow();
    const count = sqlite
      .prepare(`SELECT COUNT(*) as n FROM prompts WHERE id = 'untraced'`)
      .get() as { n: number };
    expect(count.n).toBe(1);

    void db; // keep db reference for symmetry
  });

  it('lineage join lands the sentinel for tasks defaulting root_prompt_id', () => {
    const { db, sqlite } = freshDb();
    // Insert a task without rootPromptId — DB default kicks in.
    db.insert(tasks).values({
      id: 'tsk_untraced_test',
      title: 'untraced canary',
      cwd: '/',
      status: 'queued',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
    }).run();

    const row = sqlite
      .prepare(
        `SELECT t.id AS task_id, p.id AS prompt_id
         FROM tasks t
         JOIN prompts p ON t.root_prompt_id = p.id
         WHERE t.id = 'tsk_untraced_test'`,
      )
      .get() as { task_id: string; prompt_id: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.task_id).toBe('tsk_untraced_test');
    expect(row!.prompt_id).toBe('untraced');
  });

  it('lineage queries no longer drop untraced rows', () => {
    const { db, sqlite } = freshDb();
    // 3 untraced + 1 traced.
    db.insert(prompts).values({
      id: 'prm_real',
      body: 'a real prompt',
      receivedAt: new Date().toISOString(),
      correlationId: 'real',
      hash: 'real',
    }).run();

    for (const id of ['t_a', 't_b', 't_c']) {
      db.insert(tasks).values({
        id,
        title: id,
        cwd: '/',
        status: 'queued',
        attemptCount: 0,
        createdAt: new Date().toISOString(),
      }).run();
    }
    db.insert(tasks).values({
      id: 't_d',
      title: 't_d',
      cwd: '/',
      status: 'queued',
      attemptCount: 0,
      createdAt: new Date().toISOString(),
      rootPromptId: 'prm_real',
    }).run();

    const joined = sqlite
      .prepare(
        `SELECT COUNT(*) AS n
         FROM tasks t
         JOIN prompts p ON t.root_prompt_id = p.id`,
      )
      .get() as { n: number };
    // All 4 tasks should join successfully — 3 to sentinel, 1 to prm_real.
    expect(joined.n).toBe(4);
  });
});

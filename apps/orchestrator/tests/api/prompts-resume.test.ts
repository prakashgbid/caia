/**
 * Tests for src/prompts/resume.ts — boot-time sweep of in-flight prompts.
 *
 * Per the 2026-05-04 Phase-2 stability audit (T-010); see
 * src/prompts/resume.ts for the full design rationale.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  createPrompt,
  updatePromptStatus,
} from '../../src/prompts/manager';
import { resumeStalledPrompts } from '../../src/prompts/resume';
import { eventBus } from '../../src/events/bus-adapter';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

function insertStory(
  db: Db,
  rootPromptId: string,
  status: string,
  createdAt = new Date().toISOString(),
) {
  const id = `sty_${Math.random().toString(36).slice(2, 10)}`;
  db.insert(schema.stories).values({
    id,
    title: 'test story',
    status,
    createdAt,
    rootPromptId,
  }).run();
  return id;
}

function backdatePromptRaw(sqlite: Database.Database, id: string, isoTs: string) {
  sqlite.prepare('UPDATE prompts SET received_at = ? WHERE id = ?').run(isoTs, id);
}

describe('resumeStalledPrompts (T-010)', () => {
  it('sweeps nothing when there are no prompts', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    const result = resumeStalledPrompts(db);
    expect(result.swept).toBe(0);
    expect(result.outcomes).toEqual([]);
  });

  it('skips fresh prompts under the minStalledMs threshold', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });
    createPrompt(db, { body: 'fresh prompt' });
    const result = resumeStalledPrompts(db, { minStalledMs: 60_000 });
    expect(result.swept).toBe(0);
  });

  it('classifies a stalled prompt with no descendants as cold-restart', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const p = createPrompt(db, { body: 'cold-restart candidate' });
    backdatePromptRaw(sqlite, p.id, new Date(Date.now() - 5 * 60_000).toISOString());

    const result = resumeStalledPrompts(db, { minStalledMs: 60_000 });
    expect(result.swept).toBe(1);
    expect(result.coldRestart).toBe(1);
    expect(result.warmRestart).toBe(0);
    expect(result.markedAnswered).toBe(0);
    expect(result.outcomes[0].outcome).toBe('cold-restart');
    expect(result.outcomes[0].promptId).toBe(p.id);
    // Prompt status is unchanged on cold-restart.
    const after = sqlite.prepare('SELECT status FROM prompts WHERE id = ?').get(p.id) as { status: string };
    expect(after.status).toBe('received');
  });

  it('classifies a stalled prompt with all-terminal descendants as stalled-but-complete and marks it answered', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const p = createPrompt(db, { body: 'stalled-but-complete candidate' });
    backdatePromptRaw(sqlite, p.id, new Date(Date.now() - 5 * 60_000).toISOString());

    insertStory(db, p.id, 'verified');
    insertStory(db, p.id, 'verified');

    // Treat 'verified' as terminal — it's in the TERMINAL_DESCENDANT_STATUSES?
    // No — `verified` is not in our terminal set. Use 'done' instead.
    sqlite.prepare("UPDATE stories SET status = 'done' WHERE root_prompt_id = ?").run(p.id);

    const result = resumeStalledPrompts(db, { minStalledMs: 60_000 });
    expect(result.swept).toBe(1);
    expect(result.markedAnswered).toBe(1);
    expect(result.coldRestart).toBe(0);
    expect(result.warmRestart).toBe(0);
    expect(result.outcomes[0].outcome).toBe('stalled-but-complete');

    const promptAfter = sqlite.prepare('SELECT status, completed_at FROM prompts WHERE id = ?').get(p.id) as {
      status: string; completed_at: string | null;
    };
    expect(promptAfter.status).toBe('answered');
    expect(promptAfter.completed_at).not.toBeNull();
  });

  it('classifies a stalled prompt with mixed descendants as warm-restart without mutating', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const p = createPrompt(db, { body: 'warm-restart candidate' });
    backdatePromptRaw(sqlite, p.id, new Date(Date.now() - 10 * 60_000).toISOString());
    updatePromptStatus(db, p.id, 'analyzing');

    insertStory(db, p.id, 'done');
    insertStory(db, p.id, 'pending'); // non-terminal

    const result = resumeStalledPrompts(db, { minStalledMs: 60_000 });
    expect(result.swept).toBe(1);
    expect(result.warmRestart).toBe(1);
    expect(result.coldRestart).toBe(0);
    expect(result.markedAnswered).toBe(0);
    expect(result.outcomes[0].outcome).toBe('warm-restart');
    expect(result.outcomes[0].descendantCounts).toEqual({
      total: 2,
      terminal: 1,
      nonTerminal: 1,
    });

    // Status unchanged on warm-restart.
    const promptAfter = sqlite.prepare('SELECT status FROM prompts WHERE id = ?').get(p.id) as { status: string };
    expect(promptAfter.status).toBe('analyzing');
  });

  it('honours the maxSweep cap', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const old = new Date(Date.now() - 5 * 60_000).toISOString();
    for (let i = 0; i < 5; i++) {
      const p = createPrompt(db, { body: `stalled ${i}` });
      backdatePromptRaw(sqlite, p.id, old);
    }

    const result = resumeStalledPrompts(db, { minStalledMs: 60_000, maxSweep: 3 });
    expect(result.swept).toBe(3);
    expect(result.outcomes).toHaveLength(3);
  });

  it('publishes prompt.resumed events with the right reason', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    // Wire the bus adapter so events are persisted to this in-memory DB.
    const { wireEventBus } = require('../../src/events/bus-adapter');
    wireEventBus(db);

    const p = createPrompt(db, { body: 'event-fire test' });
    backdatePromptRaw(sqlite, p.id, new Date(Date.now() - 5 * 60_000).toISOString());

    resumeStalledPrompts(db, { minStalledMs: 60_000 });

    const events = sqlite
      .prepare("SELECT type, payload_json FROM events WHERE entity_id = ? AND type = 'prompt.resumed'")
      .all(p.id) as Array<{ type: string; payload_json: string }>;
    expect(events).toHaveLength(1);
    const payload = JSON.parse(events[0].payload_json);
    expect(payload.reason).toBe('cold-restart');
    expect(payload.prompt_id).toBe(p.id);
  });

  it('is idempotent on warm-restart (second call does not double-emit state-changing side effects)', () => {
    const sqlite = new Database(':memory:');
    const db = drizzle(sqlite, { schema }) as Db;
    migrate(db, { migrationsFolder: MIGRATIONS_DIR });

    const p = createPrompt(db, { body: 'idempotency test' });
    backdatePromptRaw(sqlite, p.id, new Date(Date.now() - 10 * 60_000).toISOString());
    updatePromptStatus(db, p.id, 'analyzing');
    insertStory(db, p.id, 'done');
    insertStory(db, p.id, 'pending');

    const r1 = resumeStalledPrompts(db, { minStalledMs: 60_000 });
    const r2 = resumeStalledPrompts(db, { minStalledMs: 60_000 });

    expect(r1.warmRestart).toBe(1);
    expect(r2.warmRestart).toBe(1); // status unchanged → still warm
    // Status remains 'analyzing' both times.
    const status = sqlite.prepare('SELECT status FROM prompts WHERE id = ?').get(p.id) as { status: string };
    expect(status.status).toBe('analyzing');
  });
});

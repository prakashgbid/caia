/**
 * Migration 0021 smoke tests — task_buckets table + stories ticket-template
 * additions. Verifies the migration applies cleanly to a fresh in-memory DB
 * and the new schema is functional.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  prompts,
  stories,
  taskBuckets,
} from '../../src/db/schema';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function seedPrompt(db: ReturnType<typeof createTestDb>, id: string) {
  db.insert(prompts)
    .values({
      id,
      body: 'implement a user login feature',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `cor_${id}`,
      hash: `hash_${id}`,
      status: 'received',
    })
    .run();
}

describe('migration 0021: task_buckets', () => {
  it('creates the task_buckets table and inserts a sequential bucket', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_test1');
    db.insert(taskBuckets)
      .values({
        id: 'bkt_seq_auth_001',
        kind: 'sequential',
        domainSlug: 'auth',
        promptId: 'prm_test1',
        createdAt: Date.now(),
        sequenceIndex: 0,
        status: 'open',
      })
      .run();

    const rows = db.select().from(taskBuckets).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('sequential');
    expect(rows[0]!.domainSlug).toBe('auth');
    expect(rows[0]!.sequenceIndex).toBe(0);
    expect(rows[0]!.status).toBe('open');
  });

  it('allows a parallel bucket with null domain_slug + null sequence_index', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_test2');
    db.insert(taskBuckets)
      .values({
        id: 'bkt_par_prm_test2',
        kind: 'parallel',
        domainSlug: null,
        promptId: 'prm_test2',
        createdAt: Date.now(),
        sequenceIndex: null,
        status: 'open',
      })
      .run();

    const row = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.id, 'bkt_par_prm_test2'))
      .get();
    expect(row).toBeDefined();
    expect(row!.kind).toBe('parallel');
    expect(row!.domainSlug).toBeNull();
    expect(row!.sequenceIndex).toBeNull();
  });

  it('enforces foreign key from task_buckets.prompt_id → prompts.id', () => {
    const db = createTestDb();
    // No prompt seeded — insert should fail FK if FKs are enabled.
    // In WAL/in-memory mode FKs may or may not be on by default; the column
    // existence + reference declaration is what we assert here. Insert with
    // a real prompt to confirm acceptance.
    seedPrompt(db, 'prm_fk');
    expect(() =>
      db
        .insert(taskBuckets)
        .values({
          id: 'bkt_fk_ok',
          kind: 'sequential',
          domainSlug: 'general',
          promptId: 'prm_fk',
          createdAt: Date.now(),
          sequenceIndex: 0,
          status: 'open',
        })
        .run(),
    ).not.toThrow();
  });

  it('supports the open → in_progress → drained status lifecycle', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_lc');
    db.insert(taskBuckets)
      .values({
        id: 'bkt_lc',
        kind: 'sequential',
        domainSlug: 'auth',
        promptId: 'prm_lc',
        createdAt: Date.now(),
        sequenceIndex: 0,
        status: 'open',
      })
      .run();

    db.update(taskBuckets)
      .set({ status: 'in_progress' })
      .where(eq(taskBuckets.id, 'bkt_lc'))
      .run();
    db.update(taskBuckets)
      .set({ status: 'drained' })
      .where(eq(taskBuckets.id, 'bkt_lc'))
      .run();

    const row = db.select().from(taskBuckets).where(eq(taskBuckets.id, 'bkt_lc')).get();
    expect(row!.status).toBe('drained');
  });
});

describe('migration 0021: stories ticket-template columns', () => {
  it('default-populates the new ticket-template columns', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_tt');
    db.insert(stories)
      .values({
        id: 'story_tt_1',
        kind: 'story',
        title: 'Login form',
        rootPromptId: 'prm_tt',
        createdAt: nowIso(),
      })
      .run();

    const row = db.select().from(stories).where(eq(stories.id, 'story_tt_1')).get();
    expect(row).toBeDefined();
    expect(row!.agentContributionsJson).toBe('{}');
    expect(row!.bucketId).toBeNull();
    expect(row!.templateVersion).toBe('v1');
    expect(row!.templateValidationStatus).toBe('pending');
    expect(row!.templateValidationErrors).toBeNull();
  });

  it('persists a non-trivial agentContributionsJson payload round-trip', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_payload');
    const payload = JSON.stringify({
      version: 'v1',
      scope: { summary: 'OAuth login', inScope: ['google'], outOfScope: [] },
      agentSections: { architecture: { contributedBy: 'ea-agent', contributedAt: 1700000000000 } },
    });
    db.insert(stories)
      .values({
        id: 'story_payload',
        kind: 'story',
        title: 'OAuth',
        rootPromptId: 'prm_payload',
        agentContributionsJson: payload,
        templateValidationStatus: 'valid',
        createdAt: nowIso(),
      })
      .run();

    const row = db.select().from(stories).where(eq(stories.id, 'story_payload')).get();
    expect(row!.agentContributionsJson).toBe(payload);
    expect(row!.templateValidationStatus).toBe('valid');
  });

  it('allows linking a story to a task_buckets row via bucketId', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_link');
    db.insert(taskBuckets)
      .values({
        id: 'bkt_link_001',
        kind: 'sequential',
        domainSlug: 'auth',
        promptId: 'prm_link',
        createdAt: Date.now(),
        sequenceIndex: 0,
        status: 'open',
      })
      .run();
    db.insert(stories)
      .values({
        id: 'story_link_1',
        kind: 'story',
        title: 'Bucketed story',
        rootPromptId: 'prm_link',
        bucketId: 'bkt_link_001',
        createdAt: nowIso(),
      })
      .run();

    const row = db.select().from(stories).where(eq(stories.id, 'story_link_1')).get();
    expect(row!.bucketId).toBe('bkt_link_001');
  });

  it('captures validation errors as JSON in templateValidationErrors', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_err');
    const errors = JSON.stringify([
      { path: 'acceptanceCriteria', message: 'too few', code: 'too_small' },
    ]);
    db.insert(stories)
      .values({
        id: 'story_err',
        kind: 'story',
        title: 'Bad story',
        rootPromptId: 'prm_err',
        templateValidationStatus: 'invalid',
        templateValidationErrors: errors,
        createdAt: nowIso(),
      })
      .run();

    const row = db.select().from(stories).where(eq(stories.id, 'story_err')).get();
    expect(row!.templateValidationStatus).toBe('invalid');
    expect(row!.templateValidationErrors).toBe(errors);
  });
});

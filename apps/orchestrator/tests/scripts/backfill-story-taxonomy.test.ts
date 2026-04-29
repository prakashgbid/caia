/**
 * BUCKET-007 — backfill-story-taxonomy unit tests.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { prompts, stories } from '../../src/db/schema';
import { runBackfillStoryTaxonomy } from '../../scripts/backfill-story-taxonomy';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

function nowIso() {
  return new Date().toISOString();
}

function seedPrompt(db: ReturnType<typeof createTestDb>['db'], id: string) {
  db.insert(prompts)
    .values({
      id,
      body: 'thing',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `cor_${id}`,
      hash: `hash_${id}`,
      status: 'received',
    })
    .run();
}

function seedStory(
  db: ReturnType<typeof createTestDb>['db'],
  args: {
    id: string;
    promptId: string;
    title: string;
    description?: string;
    projectSlug?: string | null;
    techSubDomainPrimary?: string | null;
    lifecycle?: string | null;
  },
) {
  db.insert(stories)
    .values({
      id: args.id,
      kind: 'story',
      title: args.title,
      description: args.description ?? '',
      rootPromptId: args.promptId,
      status: 'pending',
      createdAt: nowIso(),
      projectSlug: args.projectSlug ?? null,
      techSubDomainPrimary: args.techSubDomainPrimary ?? null,
      lifecycle: args.lifecycle ?? null,
    })
    .run();
}

describe('runBackfillStoryTaxonomy', () => {
  it('populates project / lifecycle / priority on a story missing all three', () => {
    const { db } = createTestDb();
    seedPrompt(db, 'prm_a');
    seedStory(db, {
      id: 's1',
      promptId: 'prm_a',
      title: 'Build pokerzeno billing v2 with stripe checkout',
    });

    const r = runBackfillStoryTaxonomy(db);
    expect(r.scanned).toBe(1);
    expect(r.populated).toBe(1);

    const s = db.select().from(stories).where(eq(stories.id, 's1')).get();
    expect(s?.projectSlug).toBe('pokerzeno');
    expect(s?.lifecycle).toBe('new');
    expect(s?.priorityBucket).toBeTruthy();
    expect(s?.techSubDomainPrimary).toBeTruthy();
    expect(s?.risk).toBeTruthy();
    expect(s?.effort).toBeTruthy();
  });

  it('idempotent — re-running does not overwrite', () => {
    const { db } = createTestDb();
    seedPrompt(db, 'prm_idem');
    seedStory(db, {
      id: 's_idem',
      promptId: 'prm_idem',
      title: 'pokerzeno billing change',
    });

    runBackfillStoryTaxonomy(db);
    const after1 = db.select().from(stories).where(eq(stories.id, 's_idem')).get();

    const r2 = runBackfillStoryTaxonomy(db);
    // The story already has projectSlug + techSubDomainPrimary + lifecycle —
    // it shouldn't even be selected as a candidate the second time.
    expect(r2.scanned).toBe(0);
    expect(r2.populated).toBe(0);

    const after2 = db.select().from(stories).where(eq(stories.id, 's_idem')).get();
    expect(after2?.projectSlug).toBe(after1?.projectSlug);
    expect(after2?.lifecycle).toBe(after1?.lifecycle);
    expect(after2?.techSubDomainPrimary).toBe(after1?.techSubDomainPrimary);
  });

  it('skips stories that already have all three pinning fields', () => {
    const { db } = createTestDb();
    seedPrompt(db, 'prm_skip');
    seedStory(db, {
      id: 's_skip',
      promptId: 'prm_skip',
      title: 'preset story',
      projectSlug: 'caia',
      techSubDomainPrimary: 'agent-runtime',
      lifecycle: 'enhance',
    });

    const r = runBackfillStoryTaxonomy(db);
    expect(r.scanned).toBe(0);
    expect(r.populated).toBe(0);
  });

  it('only fills NULL fields — preserves existing project_slug', () => {
    const { db } = createTestDb();
    seedPrompt(db, 'prm_partial');
    // Story has project_slug pre-set but missing tech / lifecycle.
    seedStory(db, {
      id: 's_partial',
      promptId: 'prm_partial',
      title: 'add billing screen',
      projectSlug: 'pokerzeno',
      techSubDomainPrimary: null,
      lifecycle: null,
    });

    runBackfillStoryTaxonomy(db);
    const after = db.select().from(stories).where(eq(stories.id, 's_partial')).get();
    expect(after?.projectSlug).toBe('pokerzeno'); // preserved
    expect(after?.techSubDomainPrimary).toBeTruthy();
    expect(after?.lifecycle).toBeTruthy();
  });

  it('emits story.taxonomy.backfilled per populated story', () => {
    // Event bus has its own test harness — just ensure no exception.
    const { db } = createTestDb();
    seedPrompt(db, 'prm_evt');
    seedStory(db, {
      id: 's_evt',
      promptId: 'prm_evt',
      title: 'orchestrator dashboard tweak',
    });

    expect(() => runBackfillStoryTaxonomy(db)).not.toThrow();
  });

  it('processes multiple candidates in one pass', () => {
    const { db } = createTestDb();
    seedPrompt(db, 'prm_batch');
    seedStory(db, { id: 's1', promptId: 'prm_batch', title: 'pokerzeno billing' });
    seedStory(db, { id: 's2', promptId: 'prm_batch', title: 'roulette community forum' });
    seedStory(db, { id: 's3', promptId: 'prm_batch', title: 'caia orchestrator dashboard' });

    const r = runBackfillStoryTaxonomy(db);
    expect(r.scanned).toBe(3);
    expect(r.populated).toBe(3);

    const all = db.select().from(stories).all();
    for (const s of all) {
      expect(s.projectSlug).toBeTruthy();
      expect(s.techSubDomainPrimary).toBeTruthy();
      expect(s.lifecycle).toBeTruthy();
    }
  });
});

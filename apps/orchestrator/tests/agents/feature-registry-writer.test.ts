/**
 * FREG-003 — FeatureRegistryWriter unit + integration tests.
 *
 * Drives:
 *   - synthesizeRowFromStory: edge cases (empty title, missing project, malformed JSON tags)
 *   - handleStoryCompleted: end-to-end through DB + sqlite-vec + StubEmbeddingClient
 *   - registerFeatureRegistryWriter: lifecycle (subscribe + unsubscribe)
 *
 * Uses StubEmbeddingClient throughout so CI doesn't need Ollama.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { eq } from 'drizzle-orm';
import { computeDedupKey, StubEmbeddingClient, bootstrapVectorTables } from '@chiefaia/feature-registry';
import { eventBus } from '@chiefaia/event-bus-internal';
import {
  handleStoryCompleted,
  registerFeatureRegistryWriter,
  synthesizeRowFromStory,
} from '../../src/agents/feature-registry-writer';
import { getDb, getSqliteRaw, resetDb, runMigrations } from '../../src/db/connection';
import { stories } from '../../src/db/schema';

const DIM = 768;

function tempDbUrl(): string {
  return path.join(os.tmpdir(), `freg-writer-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

function seedStory(db: ReturnType<typeof getDb>, over: Partial<typeof stories.$inferInsert> = {}) {
  const id = (over.id as string) ?? 'story_test_a';
  const now = new Date().toISOString();
  db.insert(stories).values({
    id,
    kind: 'story',
    title: 'leaderboard page',
    description: 'ranks top players by chips won today',
    status: 'verified',
    projectSlug: 'pokerzeno',
    domainSlugsJson: JSON.stringify(['gameplay']),
    techSubDomainPrimary: 'frontend',
    qualityTagsJson: JSON.stringify(['accessibility']),
    createdAt: now,
    ...over,
  }).run();
  return id;
}

describe('synthesizeRowFromStory', () => {
  it('produces a valid row with merged tags from domain + tech + quality axes', () => {
    const story = {
      id: 'story_a',
      title: 'leaderboard page',
      description: 'ranks top players',
      status: 'verified',
      projectSlug: 'pokerzeno',
      domainSlugsJson: JSON.stringify(['gameplay', 'engagement']),
      techSubDomainPrimary: 'frontend',
      qualityTagsJson: JSON.stringify(['accessibility']),
    } as typeof stories.$inferSelect;
    const row = synthesizeRowFromStory({ story, now: 1745812800000 });
    expect(row).not.toBeNull();
    expect(row!.project).toBe('pokerzeno');
    expect(row!.name).toBe('leaderboard page');
    expect(row!.storyId).toBe('story_a');
    expect(row!.tags).toEqual(expect.arrayContaining(['gameplay', 'engagement', 'frontend', 'accessibility']));
    expect(row!.source).toBe('story_completed');
    expect(row!.dedupKey).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns null on empty title', () => {
    const story = {
      id: 'story_b',
      title: '',
      description: '...',
      status: 'verified',
      projectSlug: 'pokerzeno',
      domainSlugsJson: '[]',
      qualityTagsJson: '[]',
    } as typeof stories.$inferSelect;
    expect(synthesizeRowFromStory({ story, now: 1 })).toBeNull();
  });

  it('falls back project to "unassigned" when null', () => {
    const story = {
      id: 'story_c',
      title: 'tiny',
      description: 'thing',
      status: 'verified',
      projectSlug: null,
      domainSlugsJson: '[]',
      qualityTagsJson: '[]',
    } as typeof stories.$inferSelect;
    const row = synthesizeRowFromStory({ story, now: 1 });
    expect(row).not.toBeNull();
    expect(row!.project).toBe('unassigned');
  });

  it('survives malformed JSON in tag fields', () => {
    const story = {
      id: 'story_d',
      title: 'tiny',
      description: 'thing',
      status: 'verified',
      projectSlug: 'pokerzeno',
      domainSlugsJson: 'NOT JSON',
      qualityTagsJson: 'ALSO NOT JSON',
    } as typeof stories.$inferSelect;
    const row = synthesizeRowFromStory({ story, now: 1 });
    expect(row).not.toBeNull();
    expect(row!.tags).toEqual([]); // malformed yields no tags
  });
});

describe('handleStoryCompleted', () => {
  let url: string;

  beforeEach(() => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);
  });

  afterEach(() => {
    try { fs.unlinkSync(url); } catch { /* best-effort */ }
    resetDb();
  });

  it('upserts a registry row + embedding for an existing story', async () => {
    const db = getDb();
    const sid = seedStory(db);
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);

    const result = await handleStoryCompleted({ story_id: sid }, { embedder: stub });
    expect(result.status).toBe('ok');
    expect(result.featureId).toMatch(/^freg_/);

    const sqlite = getSqliteRaw();
    const reg = sqlite.prepare(
      'SELECT id, name, project, story_id, source FROM feature_registry WHERE story_id = ?',
    ).get(sid) as { id: string; name: string; project: string; story_id: string; source: string };
    expect(reg.story_id).toBe(sid);
    expect(reg.project).toBe('pokerzeno');
    expect(reg.source).toBe('story_completed');
    expect(reg.id).toBe(result.featureId);

    const vecRow = sqlite.prepare('SELECT id FROM feature_registry_vec WHERE id = ?').get(reg.id);
    expect(vecRow).toBeDefined();
  });

  it('is idempotent — re-handling the same story does not create a duplicate', async () => {
    const db = getDb();
    const sid = seedStory(db);
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);

    await handleStoryCompleted({ story_id: sid }, { embedder: stub });
    await handleStoryCompleted({ story_id: sid }, { embedder: stub });

    const sqlite = getSqliteRaw();
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM feature_registry').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('skips when no story_id in payload', async () => {
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const result = await handleStoryCompleted({}, { embedder: stub });
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/no story_id/);
  });

  it('skips when story is missing in DB', async () => {
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const result = await handleStoryCompleted(
      { story_id: 'story_does_not_exist' },
      { embedder: stub },
    );
    expect(result.status).toBe('skipped');
    expect(result.reason).toMatch(/not found/);
  });

  it('emits feature.registry.upserted event on success', async () => {
    const db = getDb();
    const sid = seedStory(db);
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);

    const events: Array<{ type: string; payload: { feature_id?: string; story_id?: string } }> = [];
    const unsub = eventBus.subscribe('feature.registry.upserted', (ev: any) => {
      events.push({ type: ev.type, payload: ev.payload });
    });

    await handleStoryCompleted({ story_id: sid }, { embedder: stub });

    expect(events).toHaveLength(1);
    expect(events[0]!.payload.story_id).toBe(sid);
    expect(events[0]!.payload.feature_id).toMatch(/^freg_/);
    unsub();
  });

  it('updates an existing row when called twice with new data (upsert path)', async () => {
    const db = getDb();
    const sid = seedStory(db, { description: 'first iteration of leaderboard' });
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);

    await handleStoryCompleted({ story_id: sid }, { embedder: stub });

    // Mutate the story's description, then re-fire.
    db.update(stories)
      .set({ description: 'second iteration: now with avatars' })
      .where(eq(stories.id, sid))
      .run();
    await handleStoryCompleted({ story_id: sid }, { embedder: stub });

    const sqlite = getSqliteRaw();
    const rows = sqlite
      .prepare('SELECT description FROM feature_registry')
      .all() as Array<{ description: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toMatch(/avatars/);
  });
});

describe('registerFeatureRegistryWriter', () => {
  let url: string;
  beforeEach(() => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);
  });
  afterEach(() => {
    try { fs.unlinkSync(url); } catch { /* best-effort */ }
    resetDb();
  });

  it('subscribing → publishing story.completed → registry row is written', async () => {
    const db = getDb();
    const sid = seedStory(db, { id: 'story_via_event' });
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);

    const unsub = registerFeatureRegistryWriter({ embedder: stub });

    eventBus.publish({
      type: 'story.completed',
      actor: 'api',
      entity_type: 'story',
      entity_id: sid,
      payload: {
        story_id: sid,
        project_slug: 'pokerzeno',
        status: 'verified',
        completed_at: Date.now(),
      },
    });

    // Subscriber fires async; give it a tick.
    await new Promise((r) => setTimeout(r, 50));

    const sqlite = getSqliteRaw();
    const row = sqlite
      .prepare('SELECT id, story_id FROM feature_registry WHERE story_id = ?')
      .get(sid) as { id: string; story_id: string } | undefined;
    expect(row).toBeDefined();
    expect(row!.story_id).toBe(sid);
    unsub();
  });

  it('opts.enabled=false short-circuits subscription', () => {
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const unsub = registerFeatureRegistryWriter({ embedder: stub, enabled: false });
    expect(typeof unsub).toBe('function');
    // Should not throw when called.
    unsub();
  });
});

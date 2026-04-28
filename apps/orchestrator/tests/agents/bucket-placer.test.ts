/**
 * Behavioural tests for the bucket-placement decider.
 *
 * Per the Phase-1 directive:
 *   - A story goes to a sequential-per-domain bucket iff at least one of
 *     its upstream stories has a *different* primary domain.
 *   - Otherwise (no upstream OR only same-domain upstream) it goes to the
 *     prompt's single parallel bucket. Intra-bucket ordering is enforced
 *     by the executor honouring dependsOn within the bucket.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { entityLabels, prompts, stories, taskBuckets } from '../../src/db/schema';
import { placeStoriesInBuckets } from '../../src/agents/bucket-placer';

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
  db: ReturnType<typeof createTestDb>,
  args: { id: string; promptId: string; deps?: string[]; domains?: string[] },
) {
  db.insert(stories)
    .values({
      id: args.id,
      kind: 'story',
      title: args.id,
      description: '',
      dependsOnJson: JSON.stringify(args.deps ?? []),
      domainSlugsJson: JSON.stringify(args.domains ?? []),
      status: 'pending',
      rootPromptId: args.promptId,
      createdAt: nowIso(),
    })
    .run();
}

function seedDomainLabel(
  db: ReturnType<typeof createTestDb>,
  storyId: string,
  domain: string,
) {
  db.insert(entityLabels)
    .values({
      id: `lbl_${storyId}_${domain}`,
      entityKind: 'story',
      entityId: storyId,
      labelSlug: domain,
      labelType: 'domain',
      confidence: 0.95,
      source: 'classifier',
      createdAt: Date.now(),
    })
    .run();
}

// ─── Parallel placement ─────────────────────────────────────────────────────

describe('placeStoriesInBuckets — parallel bucket', () => {
  it('places stories with no upstream deps into the parallel bucket', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_par');
    seedStory(db, { id: 'story_a', promptId: 'prm_par' });
    seedStory(db, { id: 'story_b', promptId: 'prm_par' });
    seedDomainLabel(db, 'story_a', 'auth');
    seedDomainLabel(db, 'story_b', 'ui-frontend');

    const result = placeStoriesInBuckets(
      { promptId: 'prm_par', correlationId: 'cor_par' },
      db,
    );

    expect(result.placements).toHaveLength(2);
    expect(result.parallelBucketSize).toBe(2);
    expect(result.sequentialBucketsCreated).toBe(0);
    for (const placement of result.placements) {
      expect(placement.bucketKind).toBe('parallel');
      expect(placement.domainSlug).toBeNull();
      expect(placement.bucketId).toBe('bkt_par_prm_par');
    }
  });

  it('places same-domain dependents into the parallel bucket (no cross-domain edge)', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_same');
    seedStory(db, { id: 's1', promptId: 'prm_same' });
    seedStory(db, { id: 's2', promptId: 'prm_same', deps: ['s1'] });
    seedStory(db, { id: 's3', promptId: 'prm_same', deps: ['s2'] });
    seedDomainLabel(db, 's1', 'auth');
    seedDomainLabel(db, 's2', 'auth');
    seedDomainLabel(db, 's3', 'auth');

    const result = placeStoriesInBuckets(
      { promptId: 'prm_same', correlationId: 'cor_same' },
      db,
    );
    expect(result.sequentialBucketsCreated).toBe(0);
    expect(result.parallelBucketSize).toBe(3);
    for (const p of result.placements) {
      expect(p.bucketKind).toBe('parallel');
      expect(p.bucketId).toBe('bkt_par_prm_same');
    }
  });
});

// ─── Sequential placement (cross-domain edges) ──────────────────────────────

describe('placeStoriesInBuckets — sequential bucket', () => {
  it('places a cross-domain dependent into a sequential bucket for its primary domain', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_xd');
    seedStory(db, { id: 'auth_a', promptId: 'prm_xd' });
    seedStory(db, { id: 'ui_a', promptId: 'prm_xd', deps: ['auth_a'] });
    seedDomainLabel(db, 'auth_a', 'auth');
    seedDomainLabel(db, 'ui_a', 'ui-frontend');

    const result = placeStoriesInBuckets(
      { promptId: 'prm_xd', correlationId: 'cor_xd' },
      db,
    );

    expect(result.sequentialBucketsCreated).toBe(1);
    expect(result.parallelBucketSize).toBe(1); // auth_a has no upstream → parallel
    const uiPlacement = result.placements.find((p) => p.storyId === 'ui_a')!;
    expect(uiPlacement.bucketKind).toBe('sequential');
    expect(uiPlacement.domainSlug).toBe('ui-frontend');
    expect(uiPlacement.bucketId).toBe('bkt_seq_ui-frontend_000');
  });

  it('partitions cross-domain dependents into separate sequential buckets', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_xd2');
    seedStory(db, { id: 'auth_a', promptId: 'prm_xd2' });
    seedStory(db, { id: 'data_a', promptId: 'prm_xd2', deps: ['auth_a'] });
    seedStory(db, { id: 'ui_a', promptId: 'prm_xd2', deps: ['data_a'] });
    seedDomainLabel(db, 'auth_a', 'auth');
    seedDomainLabel(db, 'data_a', 'data-storage');
    seedDomainLabel(db, 'ui_a', 'ui-frontend');

    const result = placeStoriesInBuckets(
      { promptId: 'prm_xd2', correlationId: 'cor_xd2' },
      db,
    );

    expect(result.sequentialBucketsCreated).toBe(2);
    const dataPlacement = result.placements.find((p) => p.storyId === 'data_a')!;
    const uiPlacement = result.placements.find((p) => p.storyId === 'ui_a')!;
    expect(dataPlacement.domainSlug).toBe('data-storage');
    expect(uiPlacement.domainSlug).toBe('ui-frontend');
    expect(dataPlacement.bucketId).not.toBe(uiPlacement.bucketId);
  });

  it('topologically orders multiple cross-domain dependents within one bucket', () => {
    // Two ui-frontend stories both depending on different auth-domain
    // upstreams; the second ui depends on the first ui too. They must
    // share one sequential ui-frontend bucket and be ordered correctly.
    const db = createTestDb();
    seedPrompt(db, 'prm_topo');
    seedStory(db, { id: 'auth_x', promptId: 'prm_topo' });
    seedStory(db, { id: 'auth_y', promptId: 'prm_topo' });
    seedStory(db, { id: 'ui_p', promptId: 'prm_topo', deps: ['auth_x'] });
    seedStory(db, { id: 'ui_q', promptId: 'prm_topo', deps: ['auth_y', 'ui_p'] });
    seedDomainLabel(db, 'auth_x', 'auth');
    seedDomainLabel(db, 'auth_y', 'auth');
    seedDomainLabel(db, 'ui_p', 'ui-frontend');
    seedDomainLabel(db, 'ui_q', 'ui-frontend');

    const result = placeStoriesInBuckets(
      { promptId: 'prm_topo', correlationId: 'cor_topo' },
      db,
    );

    const uiPlacements = result.placements
      .filter((p) => p.bucketKind === 'sequential' && p.domainSlug === 'ui-frontend')
      .sort((a, b) => a.positionInBucket - b.positionInBucket);
    expect(uiPlacements.map((p) => p.storyId)).toEqual(['ui_p', 'ui_q']);
    expect(uiPlacements[0]!.bucketId).toBe(uiPlacements[1]!.bucketId);
  });
});

// ─── Persistence ────────────────────────────────────────────────────────────

describe('placeStoriesInBuckets — persistence', () => {
  it('writes bucket_id back onto every story row', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_persist');
    seedStory(db, { id: 'sx', promptId: 'prm_persist' });
    seedDomainLabel(db, 'sx', 'auth');

    placeStoriesInBuckets(
      { promptId: 'prm_persist', correlationId: 'cor_persist' },
      db,
    );

    const row = db.select().from(stories).where(eq(stories.id, 'sx')).get();
    expect(row!.bucketId).toBe('bkt_par_prm_persist');
  });

  it('creates the sequential task_buckets row when cross-domain edge exists', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_scope');
    seedStory(db, { id: 's_a', promptId: 'prm_scope' });
    seedStory(db, { id: 's_b', promptId: 'prm_scope', deps: ['s_a'] });
    seedDomainLabel(db, 's_a', 'data-storage');
    seedDomainLabel(db, 's_b', 'auth'); // cross-domain edge → s_b sequential

    placeStoriesInBuckets(
      { promptId: 'prm_scope', correlationId: 'cor_scope' },
      db,
    );

    const buckets = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.promptId, 'prm_scope'))
      .all();

    const seq = buckets.find((b) => b.kind === 'sequential');
    const par = buckets.find((b) => b.kind === 'parallel');
    expect(seq).toBeDefined();
    expect(seq!.domainSlug).toBe('auth');
    expect(seq!.status).toBe('open');
    expect(seq!.sequenceIndex).toBe(0);
    expect(par).toBeDefined();
    expect(par!.domainSlug).toBeNull();
  });

  it('falls back to domain_slugs_json when no entity_labels row exists', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_fb');
    seedStory(db, {
      id: 's_fb_1',
      promptId: 'prm_fb',
      domains: ['custom-fallback'],
    });
    seedStory(db, {
      id: 's_fb_2',
      promptId: 'prm_fb',
      domains: ['other-domain'],
      deps: ['s_fb_1'],
    });
    // No entityLabels seeded — fall through to domain_slugs_json.

    const result = placeStoriesInBuckets(
      { promptId: 'prm_fb', correlationId: 'cor_fb' },
      db,
    );

    // Cross-domain edge between 'custom-fallback' and 'other-domain' →
    // s_fb_2 lands in sequential bucket for 'other-domain'.
    expect(result.sequentialBucketsCreated).toBe(1);
    const sb2 = result.placements.find((p) => p.storyId === 's_fb_2')!;
    expect(sb2.bucketKind).toBe('sequential');
    expect(sb2.domainSlug).toBe('other-domain');
  });

  it('falls back to "general" when neither labels nor domain_slugs are set', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_general');
    seedStory(db, { id: 's_gen_1', promptId: 'prm_general' });
    seedStory(db, { id: 's_gen_2', promptId: 'prm_general', deps: ['s_gen_1'] });

    const result = placeStoriesInBuckets(
      { promptId: 'prm_general', correlationId: 'cor_general' },
      db,
    );
    // Both default to 'general' — no cross-domain edge — both parallel.
    expect(result.sequentialBucketsCreated).toBe(0);
    expect(result.parallelBucketSize).toBe(2);
  });
});

// ─── Idempotency ────────────────────────────────────────────────────────────

describe('placeStoriesInBuckets — idempotency', () => {
  it('does not create duplicate sequential buckets when re-run for the same prompt', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_idem');
    seedStory(db, { id: 's_i_1', promptId: 'prm_idem' });
    seedStory(db, { id: 's_i_2', promptId: 'prm_idem', deps: ['s_i_1'] });
    seedDomainLabel(db, 's_i_1', 'auth');
    seedDomainLabel(db, 's_i_2', 'ui-frontend'); // cross-domain edge

    const first = placeStoriesInBuckets(
      { promptId: 'prm_idem', correlationId: 'cor_idem' },
      db,
    );
    expect(first.sequentialBucketsCreated).toBe(1);

    const second = placeStoriesInBuckets(
      { promptId: 'prm_idem', correlationId: 'cor_idem' },
      db,
    );
    expect(second.sequentialBucketsCreated).toBe(0); // re-used existing bucket

    const sequentialBuckets = db
      .select()
      .from(taskBuckets)
      .where(
        eq(taskBuckets.promptId, 'prm_idem'),
      )
      .all()
      .filter((b) => b.kind === 'sequential');
    expect(sequentialBuckets).toHaveLength(1);
  });
});

// ─── Empty input ────────────────────────────────────────────────────────────

describe('placeStoriesInBuckets — empty', () => {
  it('returns zero placements when the prompt has no stories', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_empty');
    const result = placeStoriesInBuckets(
      { promptId: 'prm_empty', correlationId: 'cor_empty' },
      db,
    );
    expect(result.placements).toEqual([]);
    expect(result.sequentialBucketsCreated).toBe(0);
    expect(result.parallelBucketSize).toBe(0);
  });
});

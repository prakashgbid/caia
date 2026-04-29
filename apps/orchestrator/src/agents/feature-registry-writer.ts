/**
 * FeatureRegistryWriter — FREG-003
 *
 * Subscribes to `story.completed` and idempotently upserts a
 * `feature_registry` row + its embedding via `@chiefaia/feature-registry`.
 *
 * Hot-path budget: <300ms (mostly Ollama embed). Failure modes:
 *   - Ollama unreachable → log warn, continue. Backfill picks up later.
 *   - sqlite-vec not bootstrapped → log warn, continue.
 *   - Story missing required fields → log warn, skip.
 *
 * Wired in install.ts at orchestrator startup.
 */

import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import {
  computeDedupKey,
  EmbedderUnavailableError,
  FeatureRegistryRowSchema,
  OllamaEmbeddingClient,
  upsertRegistryRow,
  type EmbeddingClient,
  type FeatureRegistryRow,
} from '@chiefaia/feature-registry';
import { eventBus } from '../events/bus-adapter';
import { getDb, getSqliteRaw } from '../db/connection';
import { stories } from '../db/schema';

// Logger shim — replaced at runtime by the real pino logger if available.
const logger = {
  warn: (obj: Record<string, unknown>, msg: string) => {
    console.warn('[feature-registry-writer]', msg, obj);
  },
  info: (obj: Record<string, unknown>, msg: string) => {
    console.log('[feature-registry-writer]', msg, obj);
  },
};

export interface RegisterWriterOpts {
  /**
   * Override the embedding client. Default: shared OllamaEmbeddingClient.
   * Tests pass StubEmbeddingClient; LAI track will pass its embedder once
   * the shared package ships.
   */
  embedder?: EmbeddingClient;
  /**
   * Disables the writer entirely. Useful in tests or when the orchestrator
   * is started in a degraded mode.
   */
  enabled?: boolean;
}

let _embedder: EmbeddingClient | null = null;
function getEmbedder(opts: RegisterWriterOpts): EmbeddingClient {
  if (opts.embedder) return opts.embedder;
  if (!_embedder) _embedder = new OllamaEmbeddingClient();
  return _embedder;
}

/**
 * Synthesize a FeatureRegistryRow from a story row.
 *
 * The mapping is intentionally conservative — for fields we can't
 * confidently derive (file_paths, route_path, component_name) we leave
 * them null. The backfill script (FREG-004) and the dashboard (FREG-007)
 * surface "thin" rows so they can be enriched.
 */
export function synthesizeRowFromStory(input: {
  story: typeof stories.$inferSelect;
  now: number;
}): FeatureRegistryRow | null {
  const { story, now } = input;
  if (!story.title || story.title.length === 0) return null;

  // Map story.status → feature.shippedAt. Stories are
  // 'pending'|'verified'|'failed'|'partial'. Only 'verified' is "done".
  const shippedAt =
    story.status === 'verified' || story.status === 'partial'
      ? now
      : now;

  const projectSlug = story.projectSlug ?? 'unassigned';
  const description = story.description && story.description.length > 0
    ? story.description.slice(0, 2000)
    : story.title;

  // Best-effort tag union: domain_slugs + tech_sub_domain_primary +
  // quality_tags. Defensive parsing — any malformed JSON yields [].
  const tags: string[] = [];
  try {
    const ds = JSON.parse(story.domainSlugsJson ?? '[]');
    if (Array.isArray(ds)) tags.push(...ds.filter((s) => typeof s === 'string'));
  } catch { /* no-op */ }
  if (story.techSubDomainPrimary) tags.push(story.techSubDomainPrimary);
  try {
    const qt = JSON.parse(story.qualityTagsJson ?? '[]');
    if (Array.isArray(qt)) tags.push(...qt.filter((s) => typeof s === 'string'));
  } catch { /* no-op */ }
  // De-dup + cap
  const uniqueTags = Array.from(new Set(tags)).slice(0, 20);

  const candidate = {
    id: `freg_${nanoid(10)}`,
    project: projectSlug as FeatureRegistryRow['project'],
    name: story.title.slice(0, 200),
    description,
    routePath: undefined,
    filePaths: [],
    componentName: undefined,
    apiEndpoint: undefined,
    dbTables: [],
    agentName: undefined,
    shippedAt,
    storyId: story.id,
    tags: uniqueTags,
    embeddingModel: 'nomic-embed-text',
    embeddingDim: 768,
    embeddingVersion: 'v1.5',
    source: 'story_completed' as const,
    createdAt: now,
    updatedAt: now,
    dedupKey: computeDedupKey({
      project: projectSlug,
      name: story.title,
      // No locator known from the story alone; fall back to the
      // sorted-file-paths bucket which becomes the empty string for
      // story-only rows. dedup_key is still unique because it includes
      // project + title.
    }),
  };
  // Return null if Zod refuses to parse (shouldn't happen given the
  // defensive defaults above, but keeps the contract honest).
  const parsed = FeatureRegistryRowSchema.safeParse(candidate);
  if (!parsed.success) {
    logger.warn(
      { storyId: story.id, errors: parsed.error.errors },
      'synthesized row failed Zod validation; skipping',
    );
    return null;
  }
  return parsed.data;
}

/**
 * The actual subscriber callback. Exported so tests can drive it
 * directly without going through the bus.
 */
export async function handleStoryCompleted(
  payload: { story_id?: string },
  opts: RegisterWriterOpts = {},
): Promise<{ status: 'ok' | 'skipped' | 'error'; featureId?: string; reason?: string }> {
  if (opts.enabled === false) return { status: 'skipped', reason: 'disabled' };
  const storyId = payload?.story_id;
  if (!storyId) return { status: 'skipped', reason: 'no story_id in payload' };

  let db;
  try {
    db = getDb();
  } catch (err) {
    return { status: 'error', reason: `getDb: ${(err as Error).message}` };
  }

  const story = db
    .select()
    .from(stories)
    .where(eq(stories.id, storyId))
    .get();
  if (!story) return { status: 'skipped', reason: `story ${storyId} not found` };

  const row = synthesizeRowFromStory({ story, now: Date.now() });
  if (!row) return { status: 'skipped', reason: 'synthesis returned null' };

  const embedder = getEmbedder(opts);
  let embedResult;
  try {
    embedResult = await embedder.embed(row.description);
  } catch (err) {
    if (err instanceof EmbedderUnavailableError) {
      logger.warn(
        { storyId, reason: err.message },
        'embedder unavailable; deferring to backfill',
      );
      return { status: 'skipped', reason: `embedder: ${err.message}` };
    }
    return { status: 'error', reason: `embed: ${(err as Error).message}` };
  }

  const sqlite = getSqliteRaw();
  try {
    upsertRegistryRow(sqlite, row, embedResult.embedding);
  } catch (err) {
    return { status: 'error', reason: `upsert: ${(err as Error).message}` };
  }

  eventBus.publish({
    type: 'feature.registry.upserted',
    actor: 'feature-registry-writer',
    entity_type: 'feature',
    entity_id: row.id,
    project_slug: row.project,
    payload: {
      feature_id: row.id,
      project: row.project,
      source: row.source,
      story_id: row.storyId,
      dedup_key: row.dedupKey,
      embedding_model: row.embeddingModel,
      latency_ms: embedResult.latencyMs,
    },
  });

  logger.info(
    { storyId, featureId: row.id, embedderTokens: embedResult.tokens },
    'registry row upserted',
  );
  return { status: 'ok', featureId: row.id };
}

/**
 * Wire the subscriber into the event bus. Returns an unsubscribe fn.
 *
 * Idempotent: calling twice is safe but discouraged (returns a fresh
 * unsubscribe each time). Tests that need to swap the embedder should
 * unsubscribe before re-registering.
 */
export function registerFeatureRegistryWriter(
  opts: RegisterWriterOpts = {},
): () => void {
  if (opts.enabled === false) {
    return () => { /* no-op */ };
  }
  const handler = async (ev: { payload?: { story_id?: string } }) => {
    try {
      await handleStoryCompleted(ev.payload ?? {}, opts);
    } catch (err) {
      logger.warn(
        { err: (err as Error).message },
        'unhandled error in story.completed handler',
      );
    }
  };
  return eventBus.subscribe('story.completed', handler);
}

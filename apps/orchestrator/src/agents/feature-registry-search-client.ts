/**
 * @fileoverview FREG-006 — orchestrator-side SearchClient wrapper.
 *
 * Wraps the @chiefaia/feature-registry search() function with the
 * orchestrator's row-loading logic (drizzle → JSON-decode → Zod). Also
 * persists every call into feature_registry_search_log for FREG-007's
 * dashboard surfaces.
 *
 * Lazy-init: the embedder is created on first call to avoid Ollama
 * connection attempts at module load time.
 */

import { eq, inArray, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import {
  FeatureRegistryRowSchema,
  OllamaEmbeddingClient,
  search as featureRegistrySearch,
  type EmbeddingClient,
  type FeatureRegistryRow,
  type SearchOpts,
  type SearchResult,
} from '@chiefaia/feature-registry';
import { eventBus } from '../events/bus-adapter';
import { getDb, getSqliteRaw } from '../db/connection';
import {
  featureRegistry,
  featureRegistrySearchLog,
} from '../db/schema';

const logger = {
  warn: (obj: Record<string, unknown>, msg: string) =>
    console.warn('[feature-registry-search]', msg, obj),
};

let _embedder: EmbeddingClient | null = null;
function getEmbedder(): EmbeddingClient {
  if (!_embedder) _embedder = new OllamaEmbeddingClient();
  return _embedder;
}

/** Test hook — replace the cached embedder. */
export function setEmbedderForTesting(e: EmbeddingClient | null): void {
  _embedder = e;
}

/**
 * Orchestrator-side row loader. Reads feature_registry rows by id (and
 * optional project) and JSON-decodes the columns Zod expects as arrays.
 * Filters out anything that fails Zod parsing — defensive vs corrupt
 * rows the dashboard would otherwise refuse to render.
 */
export function loadRegistryRowsByIds(
  ids: string[],
  project?: string,
): FeatureRegistryRow[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const rows = project
    ? db
        .select()
        .from(featureRegistry)
        .where(
          and(
            inArray(featureRegistry.id, ids),
            eq(featureRegistry.project, project),
          ),
        )
        .all()
    : db
        .select()
        .from(featureRegistry)
        .where(inArray(featureRegistry.id, ids))
        .all();

  return rows
    .map((r) => {
      try {
        const parsed = FeatureRegistryRowSchema.parse({
          id: r.id,
          project: r.project,
          name: r.name,
          description: r.description,
          routePath: r.routePath ?? undefined,
          filePaths: JSON.parse(r.filePathsJson) as string[],
          componentName: r.componentName ?? undefined,
          apiEndpoint: r.apiEndpoint ?? undefined,
          dbTables: JSON.parse(r.dbTablesJson) as string[],
          agentName: r.agentName ?? undefined,
          shippedAt: r.shippedAt,
          storyId: r.storyId ?? undefined,
          tags: JSON.parse(r.tagsJson) as string[],
          embeddingModel: r.embeddingModel,
          embeddingDim: r.embeddingDim,
          embeddingVersion: r.embeddingVersion,
          source: r.source,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          dedupKey: r.dedupKey,
        });
        return parsed;
      } catch (err) {
        logger.warn(
          { id: r.id, err: (err as Error).message },
          'feature_registry row failed Zod parse; skipping',
        );
        return null;
      }
    })
    .filter((r): r is FeatureRegistryRow => r !== null);
}

/**
 * High-level wrapper: search() + persist log + emit
 * feature.classification.* event when relevant.
 *
 * This is the function PO Agent calls.
 */
export async function searchAndLog(
  query: string,
  opts: SearchOpts & { caller?: string; storyId?: string } = {},
): Promise<SearchResult & { logged: boolean }> {
  let result: SearchResult;
  try {
    const sqlite = getSqliteRaw();
    result = await featureRegistrySearch(query, opts, {
      db: sqlite,
      embedder: getEmbedder(),
      loadRowsByIds: loadRegistryRowsByIds,
    });
  } catch (err) {
    // Embedder unavailable, sqlite-vec missing, etc. PO Agent will
    // catch this and fall back to lifecycle='new' + emit
    // feature.classification.skipped.
    throw err;
  }

  // Persist to feature_registry_search_log for FREG-007 dashboards.
  let logged = false;
  try {
    getDb()
      .insert(featureRegistrySearchLog)
      .values({
        id: `frgl_${nanoid(10)}`,
        query: query.slice(0, 2000),
        project: opts.project ?? null,
        classification: result.classification,
        topMatchId: result.topMatch?.row.id ?? null,
        topScore: result.topMatch?.scoreDense ?? null,
        thresholdUsed: result.thresholdUsed,
        latencyMs: result.latencyMs,
        embedderTokens: result.embedderTokens,
        hitCount: result.hits.length,
        caller: opts.caller ?? 'po-agent',
        createdAt: Date.now(),
      })
      .run();
    logged = true;
  } catch (err) {
    // Non-fatal: dashboard loses one row, classification still works.
    logger.warn(
      { err: (err as Error).message },
      'failed to persist search log',
    );
  }

  // Emit observability event for ambiguous classifications.
  if (
    result.classification === 'ambiguous' &&
    result.topMatch !== null &&
    opts.storyId
  ) {
    eventBus.publish({
      type: 'feature.classification.uncertain',
      actor: 'po-agent',
      entity_type: 'story',
      entity_id: opts.storyId,
      project_slug: opts.project,
      payload: {
        story_id: opts.storyId,
        top_match_id: result.topMatch.row.id,
        top_score: result.topMatch.scoreDense,
        threshold_used: result.thresholdUsed,
        project: opts.project,
      },
    });
  }

  return { ...result, logged };
}

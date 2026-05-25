/**
 * @caia/knowledge-graph-dispatch-hook — `injectContext` core API.
 *
 * Pure composition of `retrieveContext` (embedder.ts) + `buildPreamble`
 * (context-builder.ts) into a single `injectContext(brief, deps, opts?)`
 * call returning an `EnrichedBrief`.
 *
 * Failure semantics:
 *   - If `opts.disabled === true`: instant no-op. Returns original brief
 *     with `fallbackUsed: 'disabled'`.
 *   - If the AKG returns zero hits: returns original brief with
 *     `fallbackUsed: 'empty-kg'`. Does NOT throw.
 *   - If the embedder throws something other than EmbedderUnavailable
 *     (which is caught at the embedder layer): caught here and treated
 *     as `fallbackUsed: 'embedder-down'`. Returns original brief.
 *   - If `retrieveContext` falls back to sparse-only:
 *     `fallbackUsed: 'sparse-only'`. The retrieved artifacts are still
 *     used.
 *
 * The hook layer (hook.ts) wraps this with HOF + event emission.
 * Callers that want a synchronous pipeline can also call this directly.
 */

import type Database from 'better-sqlite3';
import type { EmbeddingClient } from '@chiefaia/architecture-registry';

import {
  retrieveContext,
  mergeKindMix,
  sumMix,
  type RetrieveOpts,
} from './embedder.js';
import { buildPreamble, prependPreamble } from './context-builder.js';
import type {
  DispatchBrief,
  EnrichedBrief,
  KgInjectionOpts,
  KgInjectionStats,
  RetrievedArtifact,
} from './types.js';

export interface InjectContextDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
}

const DEFAULT_BRIEF_SUMMARY_MAX_CHARS = 1200;

/**
 * Inject AKG-derived context into a dispatch brief.
 *
 * Pure-ish function: only side effects are the DB read + embedder call
 * inside `retrieveContext`. Never throws (except for genuinely
 * unrecoverable programmer errors — bad arg types, etc.).
 */
export async function injectContext(
  brief: DispatchBrief,
  deps: InjectContextDeps,
  opts: KgInjectionOpts = {},
): Promise<EnrichedBrief> {
  const t0 = Date.now();
  const mix = mergeKindMix(opts.kindMix);
  const topK = opts.topK ?? sumMix(mix);
  const threshold = opts.threshold ?? 0.6;

  // Short-circuit: disabled.
  if (opts.disabled === true) {
    return noopResult(brief, {
      topK,
      threshold,
      embedderTokens: 0,
      latencyMs: Date.now() - t0,
      retrievedCount: 0,
      sourcesByKind: emptySources(),
      fallbackUsed: 'disabled',
    });
  }

  const query = deriveQuery(brief, opts);
  if (query.trim().length === 0) {
    return noopResult(brief, {
      topK,
      threshold,
      embedderTokens: 0,
      latencyMs: Date.now() - t0,
      retrievedCount: 0,
      sourcesByKind: emptySources(),
      fallbackUsed: 'empty-kg',
    });
  }

  const retrieveOpts: RetrieveOpts = {
    topK,
    threshold,
    kindMix: opts.kindMix ?? mix,
  };
  if (opts.sparseOnly) retrieveOpts.sparseOnly = true;
  if (opts.denseOnly) retrieveOpts.denseOnly = true;
  if (brief.targetRepos && brief.targetRepos.length > 0) {
    retrieveOpts.projects = brief.targetRepos;
  }

  let artifacts: ReadonlyArray<RetrievedArtifact> = [];
  let embedderTokens = 0;
  let fallbackUsedSparseOnly = false;
  let embedderDown = false;

  try {
    const result = await retrieveContext(query, deps, retrieveOpts);
    artifacts = result.artifacts;
    embedderTokens = result.embedderTokens;
    fallbackUsedSparseOnly = result.fallbackUsedSparseOnly;
  } catch (err) {
    // EmbedderUnavailable is already caught inside retrieveContext.
    // Anything else here is a DB error, malformed AKG, etc. — never
    // block the dispatch.
    embedderDown = true;
    void err;
  }

  const preamble = buildPreamble(artifacts);
  const finalBrief = opts.preambleOnly
    ? brief.briefMd
    : prependPreamble(brief.briefMd, preamble);

  const sourcesByKind = countByKind(artifacts);
  const stats: KgInjectionStats = {
    topK,
    threshold,
    embedderTokens,
    latencyMs: Date.now() - t0,
    retrievedCount: artifacts.length,
    sourcesByKind,
    fallbackUsed: embedderDown
      ? 'embedder-down'
      : artifacts.length === 0
        ? 'empty-kg'
        : fallbackUsedSparseOnly
          ? 'sparse-only'
          : 'none',
  };

  return {
    brief: finalBrief,
    preamble,
    retrieved: artifacts,
    stats,
    callerAgentId: brief.callerAgentId,
  };
}

/**
 * Build a query string for the embedder from a `DispatchBrief`.
 *
 * Preference order:
 *   1. `opts.queryOverride` — caller knows best.
 *   2. `brief.briefSummary` — caller pre-summarised.
 *   3. Head of `brief.briefMd` capped at `briefSummaryMaxChars` (default
 *      1200) — good enough; the embedder normalises anyway.
 */
export function deriveQuery(
  brief: DispatchBrief,
  opts: KgInjectionOpts = {},
): string {
  if (opts.queryOverride !== undefined) return opts.queryOverride;
  if (brief.briefSummary !== undefined) return brief.briefSummary;
  const cap = opts.briefSummaryMaxChars ?? DEFAULT_BRIEF_SUMMARY_MAX_CHARS;
  return brief.briefMd.slice(0, cap);
}

function noopResult(
  brief: DispatchBrief,
  stats: KgInjectionStats,
): EnrichedBrief {
  return {
    brief: brief.briefMd,
    preamble: '',
    retrieved: [],
    stats,
    callerAgentId: brief.callerAgentId,
  };
}

function emptySources(): KgInjectionStats['sourcesByKind'] {
  return { adr: 0, principle: 0, lesson: 0, feedback: 0, other: 0 };
}

function countByKind(
  artifacts: ReadonlyArray<RetrievedArtifact>,
): KgInjectionStats['sourcesByKind'] {
  const acc = emptySources();
  for (const a of artifacts) {
    acc[a.kind] += 1;
  }
  return acc;
}

// middleware.ts — entry point used by the /v1/chat/completions handler.
//
// Pipeline:
//   1. Pull the (joined) user text from the chat-completions body.
//   2. Run extractMentions(); if nothing looks file/symbol-shaped, skip.
//   3. Try lookupByPaths() first — verbatim file mentions get an exact-match
//      shortcut so we save the embedding round-trip.
//   4. Otherwise embed the mentions-derived query via nomic-embed-text and
//      call topK(k=3) against the file index.
//   5. Drop results whose top-1 similarity is below a threshold (default
//      0.45 — tuned empirically against `packages/foo/bar.ts`-style
//      prompts on the 768-dim nomic vectors).
//   6. Format with injectFiles() and prepend as a system message.
//
// Disabled when:
//   - process.env.ROUTER_RAG_ENABLED !== 'true'
//   - extractMentions reports no mentions
//   - the index isn't present on disk
//   - top-1 similarity < threshold

import { extractMentions, mentionsToQuery } from './extract_mentions.js';
import { embedOne } from './embed.js';
import { loadIndex, lookupByPaths, topK, type IndexEntry } from './index.js';
import { injectFiles } from './inject.js';

export const DEFAULT_TOP_K = Number(process.env['ROUTER_RAG_TOP_K'] ?? 3);
export const DEFAULT_MIN_SIMILARITY = Number(process.env['ROUTER_RAG_MIN_SIMILARITY'] ?? 0.45);

export interface RagDecision {
  injected: boolean;
  reason: 'disabled' | 'no-mentions' | 'no-index' | 'below-threshold' | 'embed-failed' | 'injected-by-path' | 'injected-by-embed';
  systemPrepend: string;          // empty when injected=false
  filesIncluded: number;
  topSimilarity?: number;
  matchedPaths: string[];         // rel paths of the chosen files (for logging)
}

export interface RagOptions {
  enabled?: boolean;              // overrides ROUTER_RAG_ENABLED for tests
  topK?: number;
  minSimilarity?: number;
  ollamaBaseUrl?: string;
  // Pre-supplied index — test helper. When set, loadIndex() is bypassed.
  forceIndex?: ReturnType<typeof loadIndex>;
}

export function ragEnabled(opts: RagOptions = {}): boolean {
  if (opts.enabled !== undefined) return opts.enabled;
  return process.env['ROUTER_RAG_ENABLED'] === 'true';
}

/**
 * Run the RAG pipeline on a single chat-completions user message and return
 * the resulting injection decision. Never throws — embedding failures are
 * caught and surface as `reason: "embed-failed"` so the request still
 * proceeds (RAG is best-effort context, not a hard dependency).
 */
export async function runRag(
  userText: string,
  opts: RagOptions = {},
): Promise<RagDecision> {
  if (!ragEnabled(opts)) {
    return { injected: false, reason: 'disabled', systemPrepend: '', filesIncluded: 0, matchedPaths: [] };
  }

  const mentions = extractMentions(userText);
  if (!mentions.hasMentions) {
    return { injected: false, reason: 'no-mentions', systemPrepend: '', filesIncluded: 0, matchedPaths: [] };
  }

  const index = opts.forceIndex !== undefined ? opts.forceIndex : loadIndex();
  if (index === null) {
    return { injected: false, reason: 'no-index', systemPrepend: '', filesIncluded: 0, matchedPaths: [] };
  }

  const k = opts.topK ?? DEFAULT_TOP_K;

  // Fast path — verbatim file mention.
  if (mentions.paths.length > 0) {
    const exact = lookupByPaths(mentions.paths, k, index);
    if (exact.length > 0) {
      const result = injectFiles({ entries: exact });
      return {
        injected: result.filesIncluded > 0,
        reason: 'injected-by-path',
        systemPrepend: result.systemMessage,
        filesIncluded: result.filesIncluded,
        topSimilarity: 1.0,
        matchedPaths: exact.map(e => e.rel),
      };
    }
  }

  // Slow path — embed and query.
  const query = mentionsToQuery(mentions, userText);
  let queryVec: number[];
  try {
    queryVec = await embedOne(query, opts.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: opts.ollamaBaseUrl } : {});
  } catch {
    return { injected: false, reason: 'embed-failed', systemPrepend: '', filesIncluded: 0, matchedPaths: [] };
  }

  const hits = topK(queryVec, k, index);
  if (hits.length === 0) {
    return { injected: false, reason: 'no-index', systemPrepend: '', filesIncluded: 0, matchedPaths: [] };
  }
  const topSim = hits[0]?.similarity ?? 0;
  const threshold = opts.minSimilarity ?? DEFAULT_MIN_SIMILARITY;
  if (topSim < threshold) {
    return {
      injected: false,
      reason: 'below-threshold',
      systemPrepend: '',
      filesIncluded: 0,
      topSimilarity: topSim,
      matchedPaths: hits.map(h => h.entry.rel),
    };
  }

  const entries: IndexEntry[] = hits.map(h => h.entry);
  const sims = hits.map(h => h.similarity);
  const result = injectFiles({ entries, similarities: sims });
  return {
    injected: result.filesIncluded > 0,
    reason: 'injected-by-embed',
    systemPrepend: result.systemMessage,
    filesIncluded: result.filesIncluded,
    topSimilarity: topSim,
    matchedPaths: entries.map(e => e.rel),
  };
}

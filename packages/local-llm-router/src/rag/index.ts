// index.ts — file-content embedding index for the router RAG middleware.
//
// On-disk format: a single JSON document at ~/.caia/router/file_index.json
// (override with ROUTER_RAG_INDEX_PATH). Schema:
//
//   {
//     "version": 1,
//     "model": "nomic-embed-text",
//     "dim": 768,
//     "built_at": "<ISO-8601>",
//     "entries": [
//       { "path": "<abs path>", "rel": "<rel-to-root>", "size": <bytes>,
//         "preview": "<first 256 chars>", "vector": [<dim floats>] },
//       ...
//     ]
//   }
//
// JSON was chosen over SQLite because ~1.3K files × 768-float vectors lands
// at ~10 MB — well under the 50 MB "stay-in-JSON" budget in the spec. If the
// index ever blows past that, swap this module for a sqlite-backed one;
// callers only depend on `loadIndex` / `topK`.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { cosineSim } from './embed.js';

export interface IndexEntry {
  path: string;       // absolute path on disk
  rel: string;        // path relative to repo root (for display)
  size: number;       // file size in bytes at index time
  preview: string;    // first ~256 chars of the file (used by inject.ts fallback)
  vector: number[];   // embedding of the file's first 4K chars
}

export interface FileIndex {
  version: 1;
  model: string;
  dim: number;
  built_at: string;
  entries: IndexEntry[];
}

export interface TopKResult {
  entry: IndexEntry;
  similarity: number;  // cosine in [-1, 1]
}

export function defaultIndexPath(): string {
  return process.env['ROUTER_RAG_INDEX_PATH']
    ?? join(homedir(), '.caia', 'router', 'file_index.json');
}

let _cached: FileIndex | null = null;
let _cachedPath: string | null = null;

/**
 * Load the on-disk index, caching it in memory across calls. Returns null
 * (and logs to stderr) if the index is missing or malformed — the
 * middleware treats a missing index as "RAG disabled" and falls through.
 */
export function loadIndex(path: string = defaultIndexPath()): FileIndex | null {
  if (_cached !== null && _cachedPath === path) return _cached;
  if (!existsSync(path)) {
    // Don't error — the operator may not have built the index yet.
    return null;
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as FileIndex;
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      // eslint-disable-next-line no-console
      console.error(`[rag] index at ${path} has unexpected shape (version=${parsed.version})`);
      return null;
    }
    _cached = parsed;
    _cachedPath = path;
    return parsed;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[rag] failed to parse index at ${path}: ${(e as Error).message}`);
    return null;
  }
}

/** Test seam — drop the in-memory cache so a fresh read happens next call. */
export function __resetIndexCache(): void {
  _cached = null;
  _cachedPath = null;
}

/** Inject an index document directly (test helper, no disk involvement). */
export function __setIndex(idx: FileIndex | null, path: string = defaultIndexPath()): void {
  _cached = idx;
  _cachedPath = path;
}

/**
 * Return the top-k entries by cosine similarity to `queryEmbedding`.
 * Returns [] if the index is unavailable or empty.
 */
export function topK(
  queryEmbedding: number[],
  k = 3,
  index: FileIndex | null = loadIndex(),
): TopKResult[] {
  if (index === null || index.entries.length === 0) return [];
  const scored: TopKResult[] = index.entries.map(entry => ({
    entry,
    similarity: cosineSim(queryEmbedding, entry.vector),
  }));
  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, k);
}

/**
 * Path-based shortcut: if the user mentioned a known file path verbatim,
 * we can skip the embedding step and use a substring match. Returns at most
 * `k` entries whose `rel` ends with one of the mentioned paths, in mention
 * order. Used by middleware.ts as a fast path before the embed call.
 */
export function lookupByPaths(
  mentionedPaths: string[],
  k = 3,
  index: FileIndex | null = loadIndex(),
): IndexEntry[] {
  if (index === null || mentionedPaths.length === 0) return [];
  const found: IndexEntry[] = [];
  const seen = new Set<string>();
  for (const m of mentionedPaths) {
    // Normalize: drop a leading ./ or ~/, strip a trailing :line-number.
    const norm = m
      .replace(/^~\//, '')
      .replace(/^\.\//, '')
      .replace(/:\d+$/, '');
    for (const e of index.entries) {
      if (seen.has(e.path)) continue;
      if (e.rel === norm || e.rel.endsWith('/' + norm) || e.path.endsWith('/' + norm) || e.path === norm) {
        found.push(e);
        seen.add(e.path);
        if (found.length >= k) return found;
        break;
      }
    }
  }
  return found;
}

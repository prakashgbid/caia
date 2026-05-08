/**
 * Backend-aware dispatchers for `@chiefaia/librarian`.
 *
 * These thin wrappers select between the Phase-1 better-sqlite3
 * implementation (`'sqlite-vec'`) and the Phase-2 Mem0 implementation
 * (`'mem0'`) based on a `backend` flag. The Phase-1 public functions
 * (`buildIndex`, `retrievePrecedent`, `prependPrecedent`) remain
 * unchanged for callers that don't want to opt in.
 *
 * Why a separate dispatcher module rather than overloading the
 * existing public functions: keeping the dispatch surface in its
 * own module (a) lets the existing 126 Phase-1 tests run untouched,
 * (b) makes the A/B harness's call-sites self-documenting (a function
 * named `retrieveWithBackend` clearly communicates which path is being
 * exercised), and (c) preserves a hard-stop boundary in case Mem0
 * regression forces us to roll back — we delete this file and the
 * `backends/` folder, the rest of the package is unaffected.
 *
 * Hard-constraint reminder: both backends use Ollama embeddings (no
 * Anthropic API key, no OpenAI API key, no per-token billing). The
 * Mem0 path always passes `infer: false`; its LLM endpoint is
 * configured but never called.
 */

import { buildIndex, type BuildIndexOptions } from '../index-builder.js';
import {
  retrievePrecedent,
  formatPrecedentPreamble,
  type RetrievePrecedentOptions,
  type RetrievedPrecedent
} from '../retrieve.js';
import { prependPrecedent, type PrependPrecedentOptions, type PrependPrecedentResult } from '../prepend.js';
import { createOllamaEmbedder } from '../embed.js';
import type { BuildIndexStats } from '../types.js';

import {
  buildMem0Index,
  retrieveMem0Precedent,
  type BuildMem0IndexOptions,
  type RetrieveMem0PrecedentOptions
} from './mem0-backend.js';
import { DEFAULT_BACKEND, type LibrarianBackendName } from './types.js';

// The preamble format is shared across backends — using the Phase-1
// `formatPrecedentPreamble` for both ensures the prepend output is
// byte-identical regardless of which backend produced the rows.
// (No second formatter to maintain.)

export interface BuildIndexWithBackendOptions extends BuildIndexOptions {
  /** Backend to use. Defaults to `DEFAULT_BACKEND` (`'sqlite-vec'`). */
  backend?: LibrarianBackendName;
  /**
   * Mem0-specific overrides forwarded to `buildMem0Index` when
   * `backend === 'mem0'`. Ignored otherwise.
   */
  mem0?: Omit<BuildMem0IndexOptions, 'memoryDir' | 'reportsDir' | 'fsReader' | 'log' | 'now' | 'embedInputMaxBytes'>;
}

/**
 * Build/refresh the index using the selected backend.
 *
 * For `backend: 'sqlite-vec'` (default): equivalent to calling
 * `buildIndex(opts)` directly — the same `embed` + `fsReader` + DB
 * path are honoured.
 *
 * For `backend: 'mem0'`: the `embed` field in `opts` is ignored
 * (Mem0 owns its embedding pipeline). The `fsReader`, `log`, `now`,
 * and `embedInputMaxBytes` fields are forwarded. Mem0-specific
 * overrides go in `opts.mem0`.
 */
export async function buildIndexWithBackend(
  opts: BuildIndexWithBackendOptions
): Promise<BuildIndexStats> {
  const backend = opts.backend ?? DEFAULT_BACKEND;
  if (backend === 'mem0') {
    const mem0Opts: BuildMem0IndexOptions = {
      memoryDir: opts.memoryDir
    };
    if (opts.reportsDir !== undefined) mem0Opts.reportsDir = opts.reportsDir;
    if (opts.fsReader !== undefined) mem0Opts.fsReader = opts.fsReader;
    if (opts.log !== undefined) mem0Opts.log = opts.log;
    if (opts.now !== undefined) mem0Opts.now = opts.now;
    if (opts.embedInputMaxBytes !== undefined) mem0Opts.embedInputMaxBytes = opts.embedInputMaxBytes;
    if (opts.mem0 !== undefined) {
      Object.assign(mem0Opts, opts.mem0);
    }
    return buildMem0Index(mem0Opts);
  }
  return buildIndex(opts);
}

export interface RetrieveWithBackendOptions
  extends Omit<RetrievePrecedentOptions, 'embed'> {
  /** Backend to use. Defaults to `DEFAULT_BACKEND` (`'sqlite-vec'`). */
  backend?: LibrarianBackendName;
  /**
   * Embedder for the `'sqlite-vec'` backend. Required when backend is
   * `'sqlite-vec'`; ignored when backend is `'mem0'` (Mem0 owns its
   * embedding pipeline). Defaults to a default Ollama embedder if
   * omitted on the sqlite-vec path.
   */
  embed?: RetrievePrecedentOptions['embed'];
  /**
   * Mem0-specific overrides forwarded to `retrieveMem0Precedent`
   * when `backend === 'mem0'`. Ignored otherwise.
   */
  mem0?: Omit<RetrieveMem0PrecedentOptions, 'memoryDir' | 'topN' | 'minSimilarity' | 'kindFilter' | 'warn'>;
}

/**
 * Retrieve top-N precedent rows using the selected backend.
 *
 * Returns `RetrievedPrecedent[]` in both cases. The Mem0 path's
 * similarity scores are NOT linearly comparable to the sqlite-vec
 * path's — Mem0's `MemoryVectorStore` uses unnormalized cosine
 * similarity. Callers comparing scores across backends should use
 * the rank order, not the raw numbers.
 */
export async function retrieveWithBackend(
  prompt: string,
  opts: RetrieveWithBackendOptions
): Promise<RetrievedPrecedent[]> {
  const backend = opts.backend ?? DEFAULT_BACKEND;
  if (backend === 'mem0') {
    const mem0Opts: RetrieveMem0PrecedentOptions = {
      memoryDir: opts.memoryDir
    };
    if (opts.topN !== undefined) mem0Opts.topN = opts.topN;
    if (opts.minSimilarity !== undefined) mem0Opts.minSimilarity = opts.minSimilarity;
    if (opts.kindFilter !== undefined) mem0Opts.kindFilter = opts.kindFilter;
    if (opts.warn !== undefined) mem0Opts.warn = opts.warn;
    if (opts.mem0 !== undefined) Object.assign(mem0Opts, opts.mem0);
    return retrieveMem0Precedent(prompt, mem0Opts);
  }
  // sqlite-vec backend — embedder required.
  const embed = opts.embed ?? createOllamaEmbedder();
  const sqliteOpts: RetrievePrecedentOptions = {
    memoryDir: opts.memoryDir,
    embed
  };
  if (opts.dbPath !== undefined) sqliteOpts.dbPath = opts.dbPath;
  if (opts.topN !== undefined) sqliteOpts.topN = opts.topN;
  if (opts.minSimilarity !== undefined) sqliteOpts.minSimilarity = opts.minSimilarity;
  if (opts.kindFilter !== undefined) sqliteOpts.kindFilter = opts.kindFilter;
  if (opts.warn !== undefined) sqliteOpts.warn = opts.warn;
  return retrievePrecedent(prompt, sqliteOpts);
}

export interface PrependWithBackendOptions
  extends Omit<PrependPrecedentOptions, 'embed'> {
  /** Backend to use. Defaults to `DEFAULT_BACKEND` (`'sqlite-vec'`). */
  backend?: LibrarianBackendName;
  /**
   * Embedder for the `'sqlite-vec'` backend (optional — defaults to
   * Ollama). Ignored on the Mem0 path.
   */
  embed?: PrependPrecedentOptions['embed'];
  /** Mem0-specific overrides forwarded to `retrieveMem0Precedent`. */
  mem0?: RetrieveWithBackendOptions['mem0'];
}

/**
 * Pre-spawn prompt augmentation using the selected backend.
 *
 * For `backend: 'sqlite-vec'`: equivalent to `prependPrecedent`.
 *
 * For `backend: 'mem0'`: same orchestrator-facing shape — the
 * preamble byte format is identical to the Phase-1 path. Only the
 * underlying retrieval implementation changes.
 */
export async function prependWithBackend(
  prompt: string,
  opts: PrependWithBackendOptions
): Promise<PrependPrecedentResult> {
  const backend = opts.backend ?? DEFAULT_BACKEND;
  if (backend === 'mem0') {
    const retrieveOpts: RetrieveWithBackendOptions = {
      memoryDir: opts.memoryDir,
      backend: 'mem0'
    };
    if (opts.topN !== undefined) retrieveOpts.topN = opts.topN;
    if (opts.minSimilarity !== undefined) retrieveOpts.minSimilarity = opts.minSimilarity;
    if (opts.kindFilter !== undefined) retrieveOpts.kindFilter = opts.kindFilter;
    if (opts.warn !== undefined) retrieveOpts.warn = opts.warn;
    if (opts.mem0 !== undefined) retrieveOpts.mem0 = opts.mem0;
    const precedent = await retrieveWithBackend(prompt, retrieveOpts);
    if (precedent.length === 0) {
      return {
        augmentedPrompt: prompt,
        augmented: false,
        precedent: [],
        preambleLength: 0
      };
    }
    const preamble = formatPrecedentPreamble(precedent);
    const augmentedPrompt = `${preamble}\n${prompt}`;
    return {
      augmentedPrompt,
      augmented: true,
      precedent,
      preambleLength: preamble.length
    };
  }
  // sqlite-vec — delegate to the existing prepend.
  const passThrough: PrependPrecedentOptions = { memoryDir: opts.memoryDir };
  if (opts.embed !== undefined) passThrough.embed = opts.embed;
  if (opts.dbPath !== undefined) passThrough.dbPath = opts.dbPath;
  if (opts.topN !== undefined) passThrough.topN = opts.topN;
  if (opts.minSimilarity !== undefined) passThrough.minSimilarity = opts.minSimilarity;
  if (opts.kindFilter !== undefined) passThrough.kindFilter = opts.kindFilter;
  if (opts.ollamaUrl !== undefined) passThrough.ollamaUrl = opts.ollamaUrl;
  if (opts.embedModel !== undefined) passThrough.embedModel = opts.embedModel;
  if (opts.warn !== undefined) passThrough.warn = opts.warn;
  return prependPrecedent(prompt, passThrough);
}

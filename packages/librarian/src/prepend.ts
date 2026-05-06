/**
 * Librarian Phase-1 — pre-spawn prompt augmentation.
 *
 * This is the orchestrator-facing entry point. Given a task prompt
 * about to be sent to a spawned agent, return an augmented prompt with
 * a "Precedent from prior decisions — for context:" preamble built from
 * the top-N relevant prior decisions.
 *
 * Mirrors the contract documented in
 * `@chiefaia/mentor-retrieval/prepend.ts` so the two prepends compose:
 *
 *     echo "$P" | caia-mentor-prepend | caia-librarian-prepend
 *     # -> "Precedent ...\n\nLessons ...\n\n$P"
 *     # OR
 *     echo "$P" | caia-librarian-prepend | caia-mentor-prepend
 *     # -> "Lessons ...\n\nPrecedent ...\n\n$P"
 *
 * Either order works; both preambles stack at the top of the prompt
 * without colliding because each preamble's leading line is unique.
 *
 * Design contract:
 *
 *   - Synchronous from the caller's perspective: one async call returns
 *     the final prompt string. No event-bus subscription required.
 *   - Pure-ish: no side-effects on the index DB, no writes to disk by
 *     default. The caller decides whether to log the augmentation.
 *   - Graceful when no precedent matches: returns the original prompt
 *     unchanged + `precedent: []`.
 *   - Graceful when the index doesn't exist: same — returns the
 *     original prompt + `precedent: []`. Retrieve treats a missing DB
 *     as "no precedent indexed yet".
 *   - Graceful when Ollama is unreachable: throws (caller decides
 *     fallback). The orchestrator is expected to catch + emit a
 *     telemetry event + spawn the un-augmented prompt as a fallback.
 */

import { createOllamaEmbedder } from './embed.js';
import {
  formatPrecedentPreamble,
  retrievePrecedent,
  type RetrievedPrecedent
} from './retrieve.js';
import type { Embedder, PrecedentKind } from './types.js';

export interface PrependPrecedentOptions {
  /** Memory directory (or set CAIA_MEMORY_DIR). */
  memoryDir: string;
  /**
   * Embedder. Production callers usually omit this and let the helper
   * build a default Ollama embedder. Tests inject a fake.
   */
  embed?: Embedder;
  /** Override the index DB path entirely. */
  dbPath?: string;
  /** Top-N rows to inject. Default: 5. */
  topN?: number;
  /** Minimum cosine similarity. Default: 0.4. */
  minSimilarity?: number;
  /** Optional kind filter (single or list). */
  kindFilter?: PrecedentKind | PrecedentKind[];
  /** Override the Ollama URL. */
  ollamaUrl?: string;
  /** Override the embedding model. */
  embedModel?: string;
  /** Optional warn sink. Defaults to a no-op. */
  warn?: (msg: string) => void;
}

export interface PrependPrecedentResult {
  /** The prompt that the orchestrator should send to the spawned agent. */
  augmentedPrompt: string;
  /** Whether the prompt was modified (false ⇔ no relevant precedent). */
  augmented: boolean;
  /** Top-N rows that were attached (in similarity-desc order). */
  precedent: RetrievedPrecedent[];
  /** Length of the preamble in characters (0 if not augmented). */
  preambleLength: number;
}

/**
 * Build an augmented prompt with the top-N relevant prior decisions
 * prepended.
 */
export async function prependPrecedent(
  prompt: string,
  opts: PrependPrecedentOptions
): Promise<PrependPrecedentResult> {
  const embedder = opts.embed ?? createDefaultEmbedder(opts);

  const retrieveOpts: Parameters<typeof retrievePrecedent>[1] = {
    memoryDir: opts.memoryDir,
    embed: embedder
  };
  if (opts.dbPath !== undefined) retrieveOpts.dbPath = opts.dbPath;
  if (opts.topN !== undefined) retrieveOpts.topN = opts.topN;
  if (opts.minSimilarity !== undefined) {
    retrieveOpts.minSimilarity = opts.minSimilarity;
  }
  if (opts.kindFilter !== undefined) retrieveOpts.kindFilter = opts.kindFilter;
  if (opts.warn !== undefined) retrieveOpts.warn = opts.warn;

  const precedent = await retrievePrecedent(prompt, retrieveOpts);

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

function createDefaultEmbedder(opts: PrependPrecedentOptions): Embedder {
  const embedderOpts: Parameters<typeof createOllamaEmbedder>[0] = {};
  if (opts.ollamaUrl !== undefined) embedderOpts.url = opts.ollamaUrl;
  if (opts.embedModel !== undefined) embedderOpts.model = opts.embedModel;
  return createOllamaEmbedder(embedderOpts);
}

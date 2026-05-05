/**
 * Mentor Phase-3 PR-3 — pre-spawn prompt augmentation.
 *
 * This is the orchestrator-facing entry point. Given a task prompt
 * about to be sent to a spawned agent, return an augmented prompt with
 * a "Lessons from past similar work — do not repeat:" preamble built
 * from the top-N relevant prior lessons.
 *
 * Design contract for orchestrator integration:
 *
 *   - Synchronous from the caller's perspective: one async call returns
 *     the final prompt string. No event-bus subscription required.
 *   - Pure-ish: no side-effects on the index DB, no writes to disk by
 *     default. The caller decides whether to log the augmentation.
 *   - Graceful when no lessons match: returns the original prompt
 *     unchanged + `lessons: []`. Orchestrators can branch on
 *     `lessons.length === 0` if they want different telemetry.
 *   - Graceful when the index doesn't exist: same — returns the
 *     original prompt + `lessons: []`. (The retrieve layer treats a
 *     missing DB as "no lessons learned yet".)
 *   - Graceful when Ollama is unreachable: throws (caller decides
 *     fallback). The orchestrator is expected to catch + emit a
 *     telemetry event + spawn the un-augmented prompt as a fallback.
 *
 * Why not auto-emit a TaskSpawned event from this function: the
 * caller is the orchestrator, which is the canonical emit-site. Having
 * this function emit too would double-count. The orchestrator should
 * emit its own TaskSpawned + include the `lessonsAttached: number` in
 * the payload (we leave that to the orchestrator's own substrate).
 */

import { createOllamaEmbedder } from './embed.js';
import {
  formatLessonsPreamble,
  retrieveLessons,
  type RetrievedLesson
} from './retrieve.js';
import type { Embedder, LessonKind } from './types.js';

export interface PrependLessonsOptions {
  /** Memory directory (or set CAIA_MEMORY_DIR). */
  memoryDir: string;
  /**
   * Embedder. Production callers usually omit this and let the helper
   * build a default Ollama embedder. Tests inject a fake.
   */
  embed?: Embedder;
  /** Override the index DB path entirely. */
  dbPath?: string;
  /** Top-N lessons to inject. Default: 5 (matches retrieve.DEFAULT_TOP_N). */
  topN?: number;
  /** Minimum cosine similarity. Default: 0.4. */
  minSimilarity?: number;
  /** Optional kind filter (feedback / proposal). */
  kindFilter?: LessonKind;
  /**
   * Override the Ollama URL when building the default embedder. Ignored
   * if the caller passes an explicit `embed`.
   */
  ollamaUrl?: string;
  /** Override the embedding model when building the default embedder. */
  embedModel?: string;
  /** Optional warn sink. Defaults to a no-op. */
  warn?: (msg: string) => void;
}

export interface PrependLessonsResult {
  /** The prompt that the orchestrator should send to the spawned agent. */
  augmentedPrompt: string;
  /** Whether the prompt was modified (false ⇔ no relevant lessons). */
  augmented: boolean;
  /** Top-N lessons that were attached (in similarity-desc order). */
  lessons: RetrievedLesson[];
  /** Length of the preamble in characters (0 if not augmented). */
  preambleLength: number;
}

/**
 * Build an augmented prompt with the top-N relevant prior lessons
 * prepended. See module-level docstring for the orchestrator-integration
 * contract.
 */
export async function prependLessons(
  prompt: string,
  opts: PrependLessonsOptions
): Promise<PrependLessonsResult> {
  const embedder = opts.embed ?? createDefaultEmbedder(opts);

  const retrieveOpts: Parameters<typeof retrieveLessons>[1] = {
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

  const lessons = await retrieveLessons(prompt, retrieveOpts);

  if (lessons.length === 0) {
    return {
      augmentedPrompt: prompt,
      augmented: false,
      lessons: [],
      preambleLength: 0
    };
  }

  const preamble = formatLessonsPreamble(lessons);
  const augmentedPrompt = `${preamble}\n${prompt}`;

  return {
    augmentedPrompt,
    augmented: true,
    lessons,
    preambleLength: preamble.length
  };
}

function createDefaultEmbedder(opts: PrependLessonsOptions): Embedder {
  const embedderOpts: Parameters<typeof createOllamaEmbedder>[0] = {};
  if (opts.ollamaUrl !== undefined) embedderOpts.url = opts.ollamaUrl;
  if (opts.embedModel !== undefined) embedderOpts.model = opts.embedModel;
  return createOllamaEmbedder(embedderOpts);
}

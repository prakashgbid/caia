/**
 * Index builder — orchestrates source discovery + embedding + persistence
 * for Librarian Phase-1.
 *
 * Public entry point: `buildIndex(opts)`.
 *
 * Algorithm:
 *
 *   1. List all SourceFiles under memoryDir + reportsDir via the FsReader.
 *   2. For each source:
 *        - Compute SHA-256 of the FULL file content (so dedup is exact).
 *        - If the existing index row's (mtime_ms, content_sha256) match,
 *          reuse — no re-embed required.
 *        - Otherwise truncate the content to EMBED_INPUT_MAX_BYTES and
 *          embed. Truncation matters because nomic-embed-text's
 *          effective Ollama context window is ~2K tokens by default and
 *          the broader Librarian corpus (master plans, long handoff
 *          reports) regularly exceeds it. We truncate at the byte
 *          level on a UTF-8 codepoint boundary so the embedded text is
 *          always valid UTF-8.
 *   3. Remove rows whose source_path no longer exists on disk.
 *   4. Update meta keys (`last_build_at_ms`, `embedding_model`,
 *      `embedding_dim`, `last_build_scanned`).
 *   5. Read final byKind counts and return BuildIndexStats.
 *
 * Failure handling: if an individual file fails to embed, we log the
 * error, increment failedEmbed, and continue. We do NOT delete the
 * existing row for that source — a transient embed failure shouldn't
 * silently lose precedent. Only "source no longer exists on disk"
 * triggers row deletion.
 *
 * The builder is fully synchronous from the caller's perspective. A
 * streaming variant can be added later without changing the public
 * surface.
 */

import { createHash } from 'node:crypto';

import { vectorToBlob } from './embed.js';
import {
  defaultFsReader,
  pathToSlug
} from './source-readers.js';
import {
  openIndexStore,
  SNIPPET_MAX_BYTES,
  type IndexStore
} from './index-store.js';
import type {
  BuildIndexStats,
  Embedder,
  FsReader,
  IndexedPrecedent,
  SourceFile,
  SourceRoots
} from './types.js';

/**
 * Maximum bytes of UTF-8 content to send to the embedder per file.
 * Conservative because nomic-embed-text on Ollama's nomic-embed-text default num_ctx is
 * 2048 tokens. nomic-embed-text emits 768-dim vectors regardless of input length, so the marginal value of additional input bytes diminishes rapidly. 4 KB lands at roughly 1500 tokens for English markdown with code identifiers, leaving safety margin for token-dense content (paths, JSON, hashes, matrix tables) that would otherwise blow the budget, but practical limits vary with model weights and
 * Ollama configuration. 4 KB keeps us safely under the default. Files
 * longer than this are truncated at a UTF-8 codepoint boundary; the
 * full content is still hashed so dedup remains exact, and the snippet
 * column still stores the first SNIPPET_MAX_BYTES (4 KB) for display.
 *
 * Larger limits can be opted into via the `embedInputMaxBytes` option
 * for callers running Ollama with `OLLAMA_NUM_CTX=8192` or higher.
 */
export const DEFAULT_EMBED_INPUT_MAX_BYTES = 4096;

export interface BuildIndexOptions {
  /** Memory directory containing the agent's markdowns. Required. */
  memoryDir: string;
  /** Reports directory. Optional; default skipped if undefined. */
  reportsDir?: string;
  /** Embedder. Production passes createOllamaEmbedder. */
  embed: Embedder;
  /** Inject a fake fs reader for tests. */
  fsReader?: FsReader;
  /** Override the index DB path entirely (tests). */
  dbPath?: string;
  /** Logger sink. Defaults to console.error. Pass `() => {}` to silence. */
  log?: (msg: string) => void;
  /** Override `Date.now`. */
  now?: () => number;
  /**
   * Maximum bytes of content to send to the embedder per file. Defaults
   * to DEFAULT_EMBED_INPUT_MAX_BYTES (4096 bytes). Set higher when Ollama is
   * configured with a larger num_ctx. Set 0 or negative to disable
   * truncation (NOT recommended in production — nomic-embed-text returns
   * an HTTP 500 when input exceeds context length).
   */
  embedInputMaxBytes?: number;
}

export async function buildIndex(opts: BuildIndexOptions): Promise<BuildIndexStats> {
  const fsReader = opts.fsReader ?? defaultFsReader;
  const log = opts.log ?? ((m: string) => console.error(m));
  const now = opts.now ?? (() => Date.now());
  const inputCap = opts.embedInputMaxBytes ?? DEFAULT_EMBED_INPUT_MAX_BYTES;

  const start = now();

  const storeOpts: { memoryDir: string; dbPath?: string } = {
    memoryDir: opts.memoryDir
  };
  if (opts.dbPath !== undefined) storeOpts.dbPath = opts.dbPath;
  const store = openIndexStore(storeOpts);
  const indexPath = store.dbPath;

  let embeddedNew = 0;
  let reusedUnchanged = 0;
  let removedStale = 0;
  let failedEmbed = 0;
  let lastEmbedding: { model: string; dim: number } | null = null;
  // `scanned` and `byKind` are assigned inside the try block before
  // any read path. The function returns them only after the try has
  // completed (finally then runs to close the store). TypeScript's
  // definite-assignment analysis can't see that and ESLint's
  // no-useless-assignment rule flags initializers that are
  // unconditionally overwritten — the `!` definite-assignment
  // assertion is the canonical escape hatch.
  let scanned!: number;
  let byKind!: Record<string, number>;

  try {
    const roots: SourceRoots = { memoryDir: opts.memoryDir };
    if (opts.reportsDir !== undefined) roots.reportsDir = opts.reportsDir;

    const sources = fsReader.readDir(roots);
    scanned = sources.length;

    const seenPaths = new Set<string>();
    for (const src of sources) {
      seenPaths.add(src.path);
      try {
        const outcome = await processOneSource({
          src,
          store,
          embed: opts.embed,
          fsReader,
          now,
          inputCap
        });
        if (outcome.kind === 'embedded') {
          embeddedNew++;
          lastEmbedding = { model: outcome.model, dim: outcome.dim };
        } else {
          reusedUnchanged++;
        }
      } catch (e) {
        failedEmbed++;
        log(`librarian-index: failed to index ${src.path}: ${describeError(e)}`);
      }
    }

    // Remove rows for sources that vanished from disk.
    for (const existing of store.listAll()) {
      if (!seenPaths.has(existing.sourcePath)) {
        store.deleteBySourcePath(existing.sourcePath);
        removedStale++;
      }
    }

    if (lastEmbedding !== null) {
      store.setMeta('embedding_model', lastEmbedding.model);
      store.setMeta('embedding_dim', String(lastEmbedding.dim));
    }
    store.setMeta('last_build_at_ms', String(now()));
    store.setMeta('last_build_scanned', String(scanned));
    store.setMeta('embed_input_max_bytes', String(inputCap));

    byKind = store.countByKind();
  } finally {
    store.close();
  }

  const elapsedMs = now() - start;
  return {
    scanned,
    embeddedNew,
    reusedUnchanged,
    removedStale,
    failedEmbed,
    elapsedMs,
    indexPath,
    byKind
  };
}

interface ProcessSourceOutcome {
  kind: 'embedded' | 'reused';
  model: string;
  dim: number;
}

async function processOneSource(args: {
  src: SourceFile;
  store: IndexStore;
  embed: Embedder;
  fsReader: FsReader;
  now: () => number;
  inputCap: number;
}): Promise<ProcessSourceOutcome> {
  const { src, store, embed, fsReader, now, inputCap } = args;
  const content = fsReader.readFile(src.path);
  const sha256 = sha256Hex(content);

  const existing = store.getBySourcePath(src.path);
  if (
    existing !== null &&
    existing.mtimeMs === src.mtimeMs &&
    existing.contentSha256 === sha256
  ) {
    return {
      kind: 'reused',
      model: '',
      dim: existing.embeddingDim
    };
  }

  // Embed the (possibly truncated) text. We pass the leading bytes —
  // for markdown documents the title + summary + opening sections carry
  // the bulk of the topical signal that semantic similarity care
  // about. Trailing references / appendices contribute little to top-N
  // retrieval relevance.
  const embedInput = inputCap > 0 ? truncateUtf8(content, inputCap) : content;
  const result = await embed(embedInput);
  const lesson: Omit<IndexedPrecedent, 'id'> = {
    sourcePath: src.path,
    kind: src.kind,
    slug: pathToSlug(src.path),
    mtimeMs: src.mtimeMs,
    contentSha256: sha256,
    contentSnippet: snippet(content),
    embeddingDim: result.vector.length,
    embedding: vectorToBlob(result.vector),
    indexedAtMs: now()
  };
  store.upsertPrecedent(lesson);
  return {
    kind: 'embedded',
    model: result.model,
    dim: result.vector.length
  };
}

/** SHA-256 of a UTF-8 string, lowercase hex. */
export function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * Truncate UTF-8 content at a byte ceiling without splitting a
 * multi-byte codepoint. If `content` fits, returns it unchanged.
 */
export function truncateUtf8(content: string, maxBytes: number): string {
  const buf = Buffer.from(content, 'utf-8');
  if (buf.length <= maxBytes) return content;
  let end = maxBytes;
  while (end > 0) {
    const byte = buf[end];
    if (byte === undefined) break;
    if ((byte & 0xc0) !== 0x80) break;
    end--;
  }
  return buf.subarray(0, end).toString('utf-8');
}

/** Truncate to SNIPPET_MAX_BYTES bytes (UTF-8) without splitting a code-point. */
export function snippet(content: string): string {
  return truncateUtf8(content, SNIPPET_MAX_BYTES);
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

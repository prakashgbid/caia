/**
 * Index builder — orchestrates source discovery + embedding + persistence.
 *
 * Public entry point: `buildIndex(opts)`.
 *
 * Algorithm:
 *
 *   1. List all SourceFiles under memoryDir via the FsReader.
 *   2. For each source:
 *        - Compute SHA-256 of file content.
 *        - If the existing index row's (mtime_ms, content_sha256) match,
 *          reuse — no re-embed required.
 *        - Otherwise embed fresh and upsert.
 *   3. Remove rows whose source_path no longer exists on disk.
 *   4. Update meta keys (`last_build_at_ms`, `embedding_model`,
 *      `embedding_dim`).
 *   5. Return BuildIndexStats.
 *
 * Failure handling: if an individual file fails to embed, we log the
 * error, increment failedEmbed, and continue. We do NOT delete the
 * existing row for that source — a transient embed failure shouldn't
 * silently lose a lesson. Only "source no longer exists on disk"
 * triggers row deletion.
 *
 * The builder is fully synchronous from the caller's perspective: it
 * does not stream stats. For one-shot CLI usage this is the right
 * shape. A streaming variant can be added later without changing the
 * public surface.
 */

import { createHash } from 'node:crypto';

import { vectorToBlob } from './embed.js';
import { defaultFsReader, pathToSlug } from './source-readers.js';
import { openIndexStore, type IndexStore } from './index-store.js';
import { SNIPPET_MAX_BYTES } from './index-store.js';
import type {
  BuildIndexStats,
  Embedder,
  FsReader,
  IndexedLesson,
  SourceFile
} from './types.js';

export interface BuildIndexOptions {
  memoryDir: string;
  embed: Embedder;
  fsReader?: FsReader;
  /** Override the index DB path entirely (tests). */
  dbPath?: string;
  /** Logger sink. Defaults to console.error. Pass `() => {}` to silence. */
  log?: (msg: string) => void;
  /** Override `Date.now`. */
  now?: () => number;
}

export async function buildIndex(opts: BuildIndexOptions): Promise<BuildIndexStats> {
  const fsReader = opts.fsReader ?? defaultFsReader;
  const log = opts.log ?? ((m: string) => console.error(m));
  const now = opts.now ?? (() => Date.now());

  const start = now();

  const storeOpts: { memoryDir: string; dbPath?: string } = {
    memoryDir: opts.memoryDir
  };
  if (opts.dbPath !== undefined) storeOpts.dbPath = opts.dbPath;
  const store = openIndexStore(storeOpts);

  let embeddedNew = 0;
  let reusedUnchanged = 0;
  let removedStale = 0;
  let failedEmbed = 0;
  let lastEmbedding: { model: string; dim: number } | null = null;
  let scanned: number;

  try {
    const sources = fsReader.readDir(opts.memoryDir);
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
          now
        });
        if (outcome.kind === 'embedded') {
          embeddedNew++;
          lastEmbedding = { model: outcome.model, dim: outcome.dim };
        } else {
          reusedUnchanged++;
        }
      } catch (e) {
        failedEmbed++;
        log(`mentor-index: failed to index ${src.path}: ${describeError(e)}`);
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
    } else {
      // Inherit from prior build if no embeddings occurred this pass.
      // (Caller passing `embed` that returns 0 dims is a programmer error
      //  and would have been caught by extractEmbedding.)
    }
    store.setMeta('last_build_at_ms', String(now()));
    store.setMeta('last_build_scanned', String(scanned));
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
    indexPath: store.dbPath
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
}): Promise<ProcessSourceOutcome> {
  const { src, store, embed, fsReader, now } = args;
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

  // Embed text. We feed the full file content; nomic-embed-text
  // truncates at its own context window (8K tokens) which is plenty for
  // every lesson we have today.
  const result = await embed(content);
  const lesson: Omit<IndexedLesson, 'id'> = {
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
  store.upsertLesson(lesson);
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

/** Truncate to SNIPPET_MAX_BYTES bytes (UTF-8) without splitting a code-point. */
export function snippet(content: string): string {
  const buf = Buffer.from(content, 'utf-8');
  if (buf.length <= SNIPPET_MAX_BYTES) return content;
  // Find a safe truncation boundary by walking back from SNIPPET_MAX_BYTES
  // until we land on a UTF-8 lead byte (high bits not 10xxxxxx).
  let end = SNIPPET_MAX_BYTES;
  while (end > 0) {
    const byte = buf[end];
    if (byte === undefined) break;
    if ((byte & 0xc0) !== 0x80) break;
    end--;
  }
  return buf.subarray(0, end).toString('utf-8');
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

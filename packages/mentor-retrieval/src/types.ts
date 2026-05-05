/**
 * Mentor Phase-3 retrieval — shared types.
 *
 * The package operates on lessons (durable behavioral guidance under
 * `<memoryDir>/feedback_*.md`) and proposals (recent Mentor-generated
 * incident records under `<memoryDir>/proposals/*.md`). Both are
 * embedded the same way; only the `kind` field distinguishes them at
 * retrieval time so the consumer can weight or filter as needed.
 */

/** What kind of source this lesson came from. */
export type LessonKind = 'feedback' | 'proposal';

/**
 * A source file slated for indexing. `path` is the absolute path on
 * disk; `mtimeMs` is used for incremental rebuilds (skip files whose
 * mtime hasn't changed since the last index pass).
 */
export interface SourceFile {
  path: string;
  kind: LessonKind;
  mtimeMs: number;
  size: number;
}

/**
 * A row in the index. Embeddings are stored as raw Float32 little-endian
 * blobs. Production retrieval reads all rows and ranks them in JS — the
 * scale (≤ a few thousand lessons) makes ANN indexing unnecessary, and
 * a JS-side scan removes the cross-platform sqlite-vec extension dep.
 */
export interface IndexedLesson {
  id: number;
  sourcePath: string;
  kind: LessonKind;
  slug: string;
  mtimeMs: number;
  contentSha256: string;
  contentSnippet: string;
  embeddingDim: number;
  /** raw Float32 little-endian buffer; length = embeddingDim * 4 bytes */
  embedding: Buffer;
  indexedAtMs: number;
}

/** Result of a single embed call (Ollama + any future providers). */
export interface EmbedResult {
  /** The vector itself. nomic-embed-text returns 768 dims. */
  vector: Float32Array;
  /** The model identifier the provider returned (or echoed). */
  model: string;
}

/** Pluggable embedder so tests can inject a deterministic stub. */
export type Embedder = (text: string) => Promise<EmbedResult>;

/** Pluggable filesystem reader so tests can fake the source files. */
export interface FsReader {
  readDir(path: string): SourceFile[];
  readFile(path: string): string;
}

/** Outcome of a single index-builder pass. */
export interface BuildIndexStats {
  scanned: number;
  embeddedNew: number;
  reusedUnchanged: number;
  removedStale: number;
  failedEmbed: number;
  /** Total wall-clock ms for this build. */
  elapsedMs: number;
  /** Absolute path of the index DB. */
  indexPath: string;
}

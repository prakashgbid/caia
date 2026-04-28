// Core types for @chiefaia/local-rag

/** A single chunk of source text with the metadata needed to find it again. */
export interface Chunk {
  /** Stable id; sha256 of `path:startLine:endLine:content` */
  id: string;
  /** Repo-relative path of the file the chunk came from */
  path: string;
  /** 1-indexed start line (inclusive) */
  startLine: number;
  /** 1-indexed end line (inclusive) */
  endLine: number;
  /** The chunk text, exactly as it appeared in the file */
  content: string;
}

/**
 * A chunk plus its embedding. Embedding lives next to the chunk in the
 * vector store; we keep them on the same record because the access pattern
 * is "embed-then-search", not "search a separate vector index and join".
 */
export interface EmbeddedChunk extends Chunk {
  embedding: Float32Array;
}

/** A retrieval hit returned by `query()`. */
export interface RagHit {
  chunk: Chunk;
  /** Cosine similarity in [-1, 1]. Higher = more relevant. */
  score: number;
}

export interface IndexOptions {
  /** Repo-relative paths or globs to include (default: all .ts/.tsx/.md/.json) */
  include?: string[];
  /** Repo-relative paths to exclude (default: node_modules, dist, .git, .next) */
  exclude?: string[];
  /** Lines per chunk (default: 60) */
  chunkLines?: number;
  /** Overlap lines between adjacent chunks (default: 10) */
  overlapLines?: number;
  /** Max bytes per file before we skip it (default: 200_000) */
  maxFileBytes?: number;
}

export interface QueryOptions {
  /** How many hits to return (default: 5) */
  topK?: number;
  /** Minimum cosine score (default: 0.2) */
  minScore?: number;
}

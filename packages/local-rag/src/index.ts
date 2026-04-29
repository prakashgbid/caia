// @chiefaia/local-rag — local-first RAG over the CAIA monorepo.
//
// Public API:
//   const rag = new LocalRag({ dbPath: '.rag.db' });
//   await rag.indexDirectory('./packages');
//   const hits = await rag.query('how does routing-config work?');

import * as fs from 'node:fs';
import * as path from 'node:path';
import { chunkFile, type ChunkerOptions } from './chunker.js';
import { Embedder, type EmbedderOptions } from './embedder.js';
import { VectorStore } from './store.js';
import type {
  Chunk,
  EmbeddedChunk,
  IndexOptions,
  QueryOptions,
  RagHit,
} from './types.js';

export type { Chunk, EmbeddedChunk, RagHit, IndexOptions, QueryOptions };
export { Embedder } from './embedder.js';
export { VectorStore } from './store.js';
export { chunkFile } from './chunker.js';

const DEFAULT_INCLUDE = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.md',
  '.mdx',
  '.json',
  '.yaml',
  '.yml',
];

const DEFAULT_EXCLUDE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.turbo',
];

const DEFAULT_MAX_FILE_BYTES = 200_000;

export interface LocalRagOptions {
  /** Path to the sqlite file used as the vector store. */
  dbPath: string;
  /** Override embedder configuration (model, base URL, keep-alive). */
  embedder?: EmbedderOptions;
  /** Override chunker configuration (lines per chunk, overlap). */
  chunker?: ChunkerOptions;
}

export class LocalRag {
  private readonly store: VectorStore;
  private readonly embedder: Embedder;
  private readonly chunkerOptions: ChunkerOptions;

  constructor(options: LocalRagOptions) {
    this.store = new VectorStore(options.dbPath);
    this.embedder = new Embedder(options.embedder ?? {});
    this.chunkerOptions = options.chunker ?? {};

    // Record the embedding model so we can detect drift on a subsequent
    // index run (different model = different vector space; mixing them
    // silently breaks retrieval).
    const previousModel = this.store.getMeta('embedding_model');
    if (previousModel && previousModel !== this.embedder.modelTag) {
      throw new Error(
        `local-rag: existing index at ${options.dbPath} was built with ` +
          `embedding model "${previousModel}", but Embedder is configured ` +
          `for "${this.embedder.modelTag}". Delete the index or change the ` +
          `embedder model to match.`,
      );
    }
    this.store.setMeta('embedding_model', this.embedder.modelTag);
  }

  /** Total chunks currently indexed. */
  size(): number {
    return this.store.count();
  }

  close(): void {
    this.store.close();
  }

  /**
   * Walk a directory, chunk every matching file, embed and store.
   * Re-indexing is idempotent: existing chunks for a path are dropped
   * before the new ones are inserted, so partial updates are safe.
   */
  async indexDirectory(
    rootDir: string,
    options: IndexOptions = {},
    onProgress?: (event: IndexProgress) => void,
  ): Promise<IndexResult> {
    const includeExts = options.include ?? DEFAULT_INCLUDE;
    const excludeNames = new Set(options.exclude ?? DEFAULT_EXCLUDE);
    const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;

    const files = listFiles(rootDir, includeExts, excludeNames, maxFileBytes);
    onProgress?.({ kind: 'files', files: files.length });

    const allChunks: Chunk[] = [];
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      const rel = path.relative(rootDir, file);
      const chunks = chunkFile(rel, text, {
        ...this.chunkerOptions,
        ...(options.chunkLines !== undefined
          ? { chunkLines: options.chunkLines }
          : {}),
        ...(options.overlapLines !== undefined
          ? { overlapLines: options.overlapLines }
          : {}),
      });
      this.store.clearForPath(rel);
      allChunks.push(...chunks);
    }
    onProgress?.({ kind: 'chunks', chunks: allChunks.length });

    if (allChunks.length === 0) {
      return { files: files.length, chunks: 0 };
    }

    const embeddings = await this.embedder.embedBatch(
      allChunks.map((c) => c.content),
      (done, total) => {
        onProgress?.({ kind: 'embed', done, total });
      },
    );

    const embedded: EmbeddedChunk[] = allChunks.map((chunk, i) => ({
      ...chunk,
      embedding: embeddings[i]!,
    }));
    this.store.upsert(embedded);

    return { files: files.length, chunks: allChunks.length };
  }

  /** Embed `prompt` and return the top-K most similar stored chunks. */
  async query(
    prompt: string,
    options: QueryOptions = {},
  ): Promise<RagHit[]> {
    const topK = options.topK ?? 5;
    const minScore = options.minScore ?? 0.2;
    const queryEmbedding = await this.embedder.embed(prompt);
    return this.store.search(queryEmbedding, topK, minScore);
  }
}

export interface IndexResult {
  files: number;
  chunks: number;
}

export type IndexProgress =
  | { kind: 'files'; files: number }
  | { kind: 'chunks'; chunks: number }
  | { kind: 'embed'; done: number; total: number };

function listFiles(
  rootDir: string,
  includeExts: string[],
  excludeNames: Set<string>,
  maxFileBytes: number,
): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  while (stack.length) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (excludeNames.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!includeExts.some((ext) => entry.name.endsWith(ext))) continue;
      let stat: fs.Stats;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > maxFileBytes) continue;
      out.push(full);
    }
  }
  return out;
}

/**
 * Mem0 backend for `@chiefaia/librarian` — alternative retrieval
 * implementation per validation decision #4 (2026-05-06).
 *
 * Architecture summary (full design in
 * `packages/librarian/src/backends/mem0-backend.DESIGN.md`):
 *
 *   - Mem0 OSS Node.js (`mem0ai@^3`), `import { Memory } from
 *     'mem0ai/oss'`.
 *   - Configured with `infer: false` on every `add()` so the LLM
 *     round-trip is bypassed. The local extraction model (Ollama
 *     `qwen2.5-coder:7b`) is referenced only to satisfy Mem0's
 *     constructor schema; it is never actually called.
 *   - Embedder: Ollama `nomic-embed-text` (768 dims) — same model
 *     Librarian Phase-1 uses, so the two backends share embedding
 *     space and similarity numbers can be compared directly.
 *   - Vector store: Mem0's `'memory'` provider, which is misleadingly
 *     named — it persists to a better-sqlite3 file on disk. We
 *     override the `dbPath` to live next to the Librarian Phase-1
 *     index in `<memoryDir>/_librarian-mem0-index.sqlite`.
 *   - All rows tagged with `userId` (default `'caia-librarian'`) plus
 *     a `metadata` payload containing `source_path`, `kind`, `slug`,
 *     `mtime_ms`, `content_sha256`, `content_snippet`.
 *
 * The shape conforms to Option E (private package, parameterised
 * constructor with CAIA defaults, fixture-injected `memoryFactory`
 * for tests). See `agent_architecture_shape_2026-05-06.md`.
 *
 * Hard-constraint adherence:
 *   - No Anthropic API key required (Mem0's Anthropic SDK is a peer
 *     dep, only loaded when `llm.provider: 'anthropic'`).
 *   - No OpenAI API key required (the OpenAI SDK is a hard dep but
 *     only loaded when `llm.provider: 'openai'` or
 *     `embedder.provider: 'openai'`).
 *   - No per-token billing — Ollama runs locally.
 *   - Markdown stays source of truth — Mem0 stores a 4 KB snippet plus
 *     sha256 for change detection; the canonical content lives in
 *     `agent/memory/*.md`. If the index is corrupted or lost, rebuild
 *     via `caia-librarian-index build --backend mem0`.
 */

import { createHash } from 'node:crypto';
import { dirname, join, resolve as pathResolve } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

import {
  defaultFsReader,
  pathToSlug
} from '../source-readers.js';
import {
  snippet,
  truncateUtf8,
  DEFAULT_EMBED_INPUT_MAX_BYTES
} from '../index-builder.js';
import type {
  BuildIndexStats,
  FsReader,
  PrecedentKind,
  SourceRoots
} from '../types.js';
import type { RetrievedPrecedent } from '../retrieve.js';

/**
 * Subset of Mem0's `Memory` class that this backend uses. Defined as
 * an interface so tests can inject a fake without depending on the
 * real `mem0ai` package at unit-test time.
 *
 * The real `Memory` class from `mem0ai/oss` satisfies this interface
 * structurally — TypeScript's structural typing means we don't need
 * to import or extend it.
 */
export interface Mem0MemoryLike {
  add(
    content: string,
    config: { userId: string; infer?: boolean; metadata?: Record<string, unknown> }
  ): Promise<{ results: Array<{ id: string; memory: string; metadata?: Record<string, unknown> }> }>;
  search(
    query: string,
    config: { filters: Record<string, unknown>; limit?: number }
  ): Promise<{ results: Array<{ id: string; memory: string; score: number; metadata?: Record<string, unknown> }> }>;
  getAll(
    config: { filters: Record<string, unknown>; limit?: number }
  ): Promise<{ results: Array<{ id: string; memory: string; metadata?: Record<string, unknown> }> }>;
  delete(id: string): Promise<unknown>;
  update?(id: string, content: string, metadata?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Factory that produces a `Mem0MemoryLike` instance from a config
 * blob. Production callers omit this and let
 * `defaultMemoryFactory` import the real `mem0ai/oss` module on
 * first use. Tests inject a fake.
 */
export type Mem0MemoryFactory = (config: Record<string, unknown>) => Promise<Mem0MemoryLike> | Mem0MemoryLike;

/**
 * Default factory — lazily imports `mem0ai/oss` so the package is
 * not loaded when the backend isn't selected. Callers that don't
 * use `'mem0'` pay zero cost.
 */
export async function defaultMemoryFactory(config: Record<string, unknown>): Promise<Mem0MemoryLike> {
  const mod = await import('mem0ai/oss');
  // The real Memory class is constructed via `new Memory(config)`.
  const Memory = (mod as { Memory: new (c: Record<string, unknown>) => Mem0MemoryLike }).Memory;
  return new Memory(config);
}

/**
 * Filename of the Mem0-backed index DB. Named distinctly from
 * Librarian Phase-1's `_librarian-index.sqlite` so both can coexist
 * during the A/B period.
 */
export const MEM0_INDEX_DB_FILENAME = '_librarian-mem0-index.sqlite';

/** Filename of the Mem0 history DB (audit trail of add/update/delete). */
export const MEM0_HISTORY_DB_FILENAME = '_librarian-mem0-history.sqlite';

/** Default user-id partition for Librarian's Mem0 rows. */
export const DEFAULT_MEM0_USER_ID = 'caia-librarian';

/** Default Ollama URL — same as Librarian Phase-1. */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/** Default embedding model — same as Librarian Phase-1. */
export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

/** Default extraction model — only referenced by Mem0's constructor. */
export const DEFAULT_EXTRACTION_MODEL = 'qwen2.5-coder:7b';

/** Default embedding dimensionality for nomic-embed-text. */
export const DEFAULT_EMBED_DIM = 768;

/**
 * Default minimum cosine similarity for Mem0 retrieval. Mem0's
 * `MemoryVectorStore.cosineSimilarity` does not normalize the way
 * Librarian Phase-1 does, so the operating range is shifted lower
 * (probe results: correct top-1 hits at 0.296–0.463). This default
 * is more permissive than Librarian Phase-1's 0.4 and will be tuned
 * against the canonical eval suite in Step 4.
 */
export const DEFAULT_MEM0_MIN_SIMILARITY = 0.25;

/** Default top-N for retrieval. Same as Librarian Phase-1. */
export const DEFAULT_MEM0_TOP_N = 5;

export interface Mem0BackendOptions {
  /** memoryDir — root for the index DB filename when `vectorStoreDbPath` is unset. Required. */
  memoryDir: string;
  /** Override the absolute path of the Mem0 vector-store DB. */
  vectorStoreDbPath?: string;
  /** Override the absolute path of the Mem0 history DB. */
  historyDbPath?: string;
  /** Mem0 user-id partition. Default: `'caia-librarian'`. */
  userId?: string;
  /** Ollama URL. Default: `'http://127.0.0.1:11434'`. */
  ollamaUrl?: string;
  /** Embedding model. Default: `'nomic-embed-text'`. */
  embedModel?: string;
  /** Embedding dimensionality. Default: 768. */
  embedDim?: number;
  /** Extraction model — only for Mem0's constructor schema; never invoked. */
  extractionModel?: string;
  /** Test seam — inject a fake `Memory` factory. */
  memoryFactory?: Mem0MemoryFactory;
}

export class Mem0Backend {
  readonly name = 'mem0' as const;
  readonly indexPath: string;
  readonly historyDbPath: string;
  readonly userId: string;
  readonly ollamaUrl: string;
  readonly embedModel: string;
  readonly embedDim: number;
  readonly extractionModel: string;
  private readonly memoryFactory: Mem0MemoryFactory;
  private memory: Mem0MemoryLike | null = null;

  constructor(opts: Mem0BackendOptions) {
    if (!opts.memoryDir || opts.memoryDir.trim() === '') {
      throw new Error('Mem0Backend: memoryDir is required');
    }
    const root = pathResolve(opts.memoryDir);
    this.indexPath = opts.vectorStoreDbPath ?? join(root, MEM0_INDEX_DB_FILENAME);
    this.historyDbPath = opts.historyDbPath ?? join(root, MEM0_HISTORY_DB_FILENAME);
    this.userId = opts.userId ?? DEFAULT_MEM0_USER_ID;
    this.ollamaUrl = opts.ollamaUrl ?? DEFAULT_OLLAMA_URL;
    this.embedModel = opts.embedModel ?? DEFAULT_EMBED_MODEL;
    this.embedDim = opts.embedDim ?? DEFAULT_EMBED_DIM;
    this.extractionModel = opts.extractionModel ?? DEFAULT_EXTRACTION_MODEL;
    this.memoryFactory = opts.memoryFactory ?? defaultMemoryFactory;
  }

  /**
   * Get the (lazily constructed) `Mem0MemoryLike` instance. Public
   * for tests; production callers go through `build()` /
   * `retrieve()` which initialise on first use.
   */
  async getMemory(): Promise<Mem0MemoryLike> {
    if (this.memory !== null) return this.memory;
    // Ensure the parent dir exists for the SQLite files.
    const parent = dirname(this.indexPath);
    if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
    const config = buildMem0Config({
      vectorStoreDbPath: this.indexPath,
      historyDbPath: this.historyDbPath,
      ollamaUrl: this.ollamaUrl,
      embedModel: this.embedModel,
      embedDim: this.embedDim,
      extractionModel: this.extractionModel
    });
    this.memory = await Promise.resolve(this.memoryFactory(config));
    return this.memory;
  }
}

/**
 * Build the config object passed to Mem0's `Memory` constructor.
 * Exported for testing the config shape independently of the
 * runtime.
 */
export function buildMem0Config(opts: {
  vectorStoreDbPath: string;
  historyDbPath: string;
  ollamaUrl: string;
  embedModel: string;
  embedDim: number;
  extractionModel: string;
}): Record<string, unknown> {
  return {
    version: 'v1.1',
    llm: {
      provider: 'ollama',
      config: {
        model: opts.extractionModel,
        url: opts.ollamaUrl
      }
    },
    embedder: {
      provider: 'ollama',
      config: {
        model: opts.embedModel,
        url: opts.ollamaUrl
      }
    },
    vectorStore: {
      provider: 'memory',
      config: {
        collectionName: 'librarian',
        dimension: opts.embedDim,
        dbPath: opts.vectorStoreDbPath
      }
    },
    historyDbPath: opts.historyDbPath
  };
}

export interface BuildMem0IndexOptions {
  /** Memory directory containing the agent's markdowns. Required. */
  memoryDir: string;
  /** Reports directory. Optional. */
  reportsDir?: string;
  /** Override fs reader (tests). */
  fsReader?: FsReader;
  /** Logger sink. Defaults to console.error. */
  log?: (msg: string) => void;
  /** Clock injection. */
  now?: () => number;
  /** Truncation cap before passing content to Mem0. Default 4096. */
  embedInputMaxBytes?: number;
  /** Backend instance to use. Constructed from `memoryDir` if omitted. */
  backend?: Mem0Backend;
  /** Forwarded constructor options when `backend` is omitted. */
  backendOptions?: Omit<Mem0BackendOptions, 'memoryDir'>;
}

/**
 * Build/refresh a Mem0-backed Librarian index.
 *
 * Algorithm:
 *   1. Walk roots via `fsReader` to get `SourceFile[]`.
 *   2. Pull existing rows once via `mem.getAll` so we can do
 *      sha256-based change detection without N round-trips.
 *   3. For each source: read content, sha256, decide reuse / update /
 *      add. Truncation matches Librarian Phase-1.
 *   4. Remove rows whose `source_path` is no longer in the seen set.
 *   5. Return `BuildIndexStats` shape so callers can format the same
 *      report they'd format for the Phase-1 backend.
 */
export async function buildMem0Index(opts: BuildMem0IndexOptions): Promise<BuildIndexStats> {
  const fsReader = opts.fsReader ?? defaultFsReader;
  const log = opts.log ?? ((m: string) => console.error(m));
  const now = opts.now ?? (() => Date.now());
  const inputCap = opts.embedInputMaxBytes ?? DEFAULT_EMBED_INPUT_MAX_BYTES;
  const backend = opts.backend ?? new Mem0Backend({ memoryDir: opts.memoryDir, ...(opts.backendOptions ?? {}) });

  const start = now();
  const memory = await backend.getMemory();

  const roots: SourceRoots = { memoryDir: opts.memoryDir };
  if (opts.reportsDir !== undefined) roots.reportsDir = opts.reportsDir;
  const sources = fsReader.readDir(roots);

  // Bulk load existing rows once to drive sha-based reuse logic.
  const existing = await listAllByPath(memory, backend.userId);

  let embeddedNew = 0;
  let reusedUnchanged = 0;
  let removedStale = 0;
  let failedEmbed = 0;
  const seen = new Set<string>();
  const byKind: Record<string, number> = {};

  for (const src of sources) {
    seen.add(src.path);
    try {
      const content = fsReader.readFile(src.path);
      const sha = sha256Hex(content);
      const prior = existing.get(src.path);
      if (
        prior !== undefined &&
        prior.metadata?.['content_sha256'] === sha &&
        prior.metadata?.['mtime_ms'] === src.mtimeMs
      ) {
        reusedUnchanged++;
        bumpKind(byKind, src.kind);
        continue;
      }
      const truncated = inputCap > 0 ? truncateUtf8(content, inputCap) : content;
      const metadata: Record<string, unknown> = {
        source_path: src.path,
        kind: src.kind,
        slug: pathToSlug(src.path),
        mtime_ms: src.mtimeMs,
        content_sha256: sha,
        content_snippet: snippet(content),
        indexed_at_ms: now()
      };
      if (prior !== undefined) {
        // Replace: delete + add. Mem0's update() exists but is not
        // available across all v3.x patch versions; the round-trip
        // delta is small for our scale.
        try {
          await memory.delete(prior.id);
        } catch (e) {
          log(`librarian-mem0: warn deleting prior row ${prior.id}: ${describeError(e)}`);
        }
      }
      await memory.add(truncated, {
        userId: backend.userId,
        infer: false,
        metadata
      });
      embeddedNew++;
      bumpKind(byKind, src.kind);
    } catch (e) {
      failedEmbed++;
      log(`librarian-mem0: failed to index ${src.path}: ${describeError(e)}`);
    }
  }

  // Remove rows whose source no longer exists on disk.
  for (const [path, row] of existing.entries()) {
    if (seen.has(path)) continue;
    try {
      await memory.delete(row.id);
      removedStale++;
    } catch (e) {
      log(`librarian-mem0: warn deleting stale ${path}: ${describeError(e)}`);
    }
  }

  return {
    scanned: sources.length,
    embeddedNew,
    reusedUnchanged,
    removedStale,
    failedEmbed,
    elapsedMs: now() - start,
    indexPath: backend.indexPath,
    byKind
  };
}

export interface RetrieveMem0PrecedentOptions {
  /** Same memoryDir used at build time. */
  memoryDir: string;
  /** Top-N results. Default 5. */
  topN?: number;
  /** Minimum similarity. Default 0.25 for the Mem0 backend. */
  minSimilarity?: number;
  /** Optional kind filter. */
  kindFilter?: PrecedentKind | PrecedentKind[];
  /** Backend instance to use; constructed from `memoryDir` if omitted. */
  backend?: Mem0Backend;
  /** Forwarded constructor options when `backend` is omitted. */
  backendOptions?: Omit<Mem0BackendOptions, 'memoryDir'>;
  /** Optional warn sink. */
  warn?: (msg: string) => void;
}

/**
 * Retrieve top-N precedent rows from the Mem0-backed index. Mirrors
 * the contract of `retrievePrecedent` from Librarian Phase-1.
 *
 * Returns an empty array if Mem0 hasn't been built yet (the
 * MemoryVectorStore creates an empty SQLite table on first
 * construction; an empty table searches as empty).
 */
export async function retrieveMem0Precedent(
  prompt: string,
  opts: RetrieveMem0PrecedentOptions
): Promise<RetrievedPrecedent[]> {
  const topN = opts.topN ?? DEFAULT_MEM0_TOP_N;
  const minSim = opts.minSimilarity ?? DEFAULT_MEM0_MIN_SIMILARITY;
  const warn = opts.warn ?? ((_m: string) => undefined);
  const backend = opts.backend ?? new Mem0Backend({ memoryDir: opts.memoryDir, ...(opts.backendOptions ?? {}) });

  const memory = await backend.getMemory();
  const filters: Record<string, unknown> = { user_id: backend.userId };
  if (opts.kindFilter !== undefined) {
    const kinds = Array.isArray(opts.kindFilter) ? opts.kindFilter : [opts.kindFilter];
    if (kinds.length > 0) filters['kind'] = { in: kinds };
  }

  let resp;
  try {
    resp = await memory.search(prompt, { filters, limit: topN });
  } catch (e) {
    warn(`librarian-mem0: search failed: ${describeError(e)}`);
    return [];
  }

  const out: RetrievedPrecedent[] = [];
  for (const r of resp.results ?? []) {
    if (typeof r.score !== 'number' || !Number.isFinite(r.score)) continue;
    if (r.score < minSim) continue;
    const md = r.metadata ?? {};
    const path = typeof md['source_path'] === 'string' ? md['source_path'] : '';
    const kindRaw = md['kind'];
    const kind: PrecedentKind = (typeof kindRaw === 'string' ? kindRaw : 'other') as PrecedentKind;
    const slug = typeof md['slug'] === 'string' ? md['slug'] : '';
    const snippetText = typeof md['content_snippet'] === 'string'
      ? md['content_snippet']
      : r.memory ?? '';
    const mtimeMs = typeof md['mtime_ms'] === 'number' ? md['mtime_ms'] : 0;
    if (path === '' || slug === '') {
      // Skip rows that lack our own metadata (e.g. were inserted by
      // some other producer against the same DB partition). This
      // shouldn't happen given userId partitioning but is defensive.
      continue;
    }
    out.push({ path, kind, slug, similarity: r.score, snippet: snippetText, mtimeMs });
  }

  out.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    return b.mtimeMs - a.mtimeMs;
  });

  return out.slice(0, topN);
}

interface ExistingRow {
  id: string;
  metadata: Record<string, unknown>;
}

async function listAllByPath(memory: Mem0MemoryLike, userId: string): Promise<Map<string, ExistingRow>> {
  const out = new Map<string, ExistingRow>();
  // Mem0's getAll has a default limit of 100; for our corpus (hundreds
  // of files) we set it high. The factory pattern ensures the
  // underlying provider can handle this.
  const resp = await memory.getAll({ filters: { user_id: userId }, limit: 100_000 });
  for (const r of resp.results ?? []) {
    const md = r.metadata ?? {};
    const sp = typeof md['source_path'] === 'string' ? md['source_path'] : null;
    if (sp === null) continue;
    out.set(sp, { id: r.id, metadata: md });
  }
  return out;
}

function bumpKind(byKind: Record<string, number>, kind: PrecedentKind): void {
  byKind[kind] = (byKind[kind] ?? 0) + 1;
}

function sha256Hex(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

function describeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

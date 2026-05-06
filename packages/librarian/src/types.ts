/**
 * Librarian Phase-1 — shared types.
 *
 * Librarian operates on a UNIFIED corpus of prior decisions:
 *
 *   - directives  (`<memoryDir>/*_directive.md` — agent specs / arch decisions)
 *   - feedback    (`<memoryDir>/feedback_*.md` — durable rules)
 *   - proposal    (`<memoryDir>/proposals/*.md` — recent Mentor incidents)
 *   - registry    (`<memoryDir>/*_registry_directive.md` — catalogs)
 *   - architecture(`<memoryDir>/*_architecture.md` — architecture refs)
 *   - master      (`<memoryDir>/master_*.md` — sequencing + roadmap)
 *   - landscape   (`<memoryDir>/*_landscape*.md`, enterprise_*.md — ecosystem research)
 *   - gate        (`<memoryDir>/gate_*.md`, evidence_*.md — gate + evidence rules)
 *   - consolidation(`<memoryDir>/consolidation_*.md`)
 *   - daemon      (`<memoryDir>/daemon_*.md`)
 *   - cci         (`<memoryDir>/cci_*.md`)
 *   - mac         (`<memoryDir>/mac_*.md`)
 *   - mcp         (`<memoryDir>/mcp_*.md`)
 *   - safety      (`<memoryDir>/safety_*.md`)
 *   - phase       (`<memoryDir>/phase*.md`)
 *   - team        (`<memoryDir>/caia_*.md`, `orchestrator_*.md`)
 *   - backlog     (`<memoryDir>/backlog_*.md`)
 *   - report      (`<reportsDir>/*.md` — handoffs, completion reports, analyses)
 *
 * The kind is a CLASSIFICATION, not an authoritative source-of-truth tag —
 * it is computed deterministically from filename + path. The retrieval
 * layer can filter by kind to surface only architecture decisions, only
 * reports, etc., but the default retrieval blends all kinds.
 *
 * Compared to Mentor's `LessonKind = 'feedback' | 'proposal'`:
 *   - Strictly broader: every Mentor kind is also a Librarian kind.
 *   - More granular: reports + directives + registries + landscape +
 *     architecture etc. are first-class.
 *   - Stored in a SEPARATE table (`precedent`) in a SEPARATE DB
 *     (`<memoryDir>/_librarian-index.sqlite`) so Mentor's read-only
 *     contract on its own DB is not violated.
 */

/** All recognized precedent kinds. New kinds may be added; consumers must accept unknown values gracefully. */
export type PrecedentKind =
  | 'directive'
  | 'feedback'
  | 'proposal'
  | 'registry'
  | 'architecture'
  | 'master'
  | 'landscape'
  | 'gate'
  | 'consolidation'
  | 'daemon'
  | 'cci'
  | 'mac'
  | 'mcp'
  | 'safety'
  | 'phase'
  | 'team'
  | 'backlog'
  | 'report'
  | 'other';

/** Set of all known kinds for O(1) membership checks. */
export const ALL_PRECEDENT_KINDS: readonly PrecedentKind[] = Object.freeze([
  'directive',
  'feedback',
  'proposal',
  'registry',
  'architecture',
  'master',
  'landscape',
  'gate',
  'consolidation',
  'daemon',
  'cci',
  'mac',
  'mcp',
  'safety',
  'phase',
  'team',
  'backlog',
  'report',
  'other'
]);

/** Predicate guard for runtime checks (e.g. when reading rows from the DB). */
export function isPrecedentKind(v: unknown): v is PrecedentKind {
  return typeof v === 'string' && (ALL_PRECEDENT_KINDS as readonly string[]).includes(v);
}

/**
 * A source file slated for indexing. `path` is the absolute path on
 * disk; `mtimeMs` is used for incremental rebuilds (skip files whose
 * mtime hasn't changed since the last index pass).
 */
export interface SourceFile {
  path: string;
  kind: PrecedentKind;
  mtimeMs: number;
  size: number;
}

/**
 * A row in the index. Embeddings are stored as raw Float32 little-endian
 * blobs. Production retrieval reads all rows and ranks them in JS — the
 * scale (≈200 entries today, plausibly 1000+ in a year) makes ANN
 * indexing unnecessary, and a JS-side scan removes the cross-platform
 * sqlite-vec extension dep.
 */
export interface IndexedPrecedent {
  id: number;
  sourcePath: string;
  kind: PrecedentKind;
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
  /**
   * Walk the configured roots and return all qualifying SourceFiles.
   * Implementations MUST classify each file via `pathToKind` and emit a
   * deterministic order (sorted by absolute path).
   */
  readDir(roots: SourceRoots): SourceFile[];
  readFile(path: string): string;
}

/** Where the FsReader looks for sources. */
export interface SourceRoots {
  /** Memory directory containing directives, feedback, proposals, etc. */
  memoryDir: string;
  /**
   * Reports directory (default: ~/Documents/projects/reports). May be
   * undefined or non-existent — implementations must skip gracefully.
   */
  reportsDir?: string;
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
  /** Per-kind row count after this pass. */
  byKind: Record<string, number>;
}

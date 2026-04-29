/**
 * Shared types for ts-morph AST extractors (ARCH-002).
 */

import type { ArchArtifactRow, ArchEdgeRow } from '../schema';

/**
 * What the extractor returns. Caller (storage layer or ARCH-007 dashboard)
 * upserts these into the DB. We don't write directly here so the
 * extractor is unit-testable without a SQLite dependency.
 */
export interface ExtractionResult {
  artifacts: ArchArtifactRow[];
  edges: ArchEdgeRow[];
  /**
   * Per-extractor diagnostic counters (warning lines, files skipped, etc.)
   * surfaced to the dashboard "extract runs" panel (ARCH-007).
   */
  warnings: string[];
}

export interface ExtractorOptions {
  /** Repo root; all extracted file paths are made relative to this. */
  repoRoot: string;
  /**
   * Default project slug for extracted artifacts. Tests / mono-repo
   * scanners can pass a per-app override via per-call options.
   */
  defaultProject: string;
  /** epoch-ms timestamp to stamp on createdAt/updatedAt. */
  now: number;
  /** Optional commit SHA at extraction time. */
  extractedAtCommit?: string;
  /**
   * Caller-provided ID factory. Defaults to `arch_<nanoid12>`. Tests
   * pass a deterministic factory so fixtures snapshot cleanly.
   */
  newId?: (prefix: string) => string;
}

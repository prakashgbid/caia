/**
 * @chiefaia/surface — public type surface.
 *
 * Surface Agent ingests three subscription-free sources (gh PR list, memory
 * file diffs, agent transcript metadata), scores each item by importance, and
 * emits a markdown digest under a hard size cap.
 *
 * Phase 0 ships heuristic-only scoring (no LLM). Phase 2 adds operator-voice
 * rephrasing once the Apprentice operator-style adapter is mature.
 */

/** Where a finding came from. Stable across phases. */
export type FindingSource = 'pr' | 'memory' | 'transcript' | 'connector-error';

/** Coarse human label — drives section grouping in the digest. */
export type FindingKind =
  | 'pr-merged'
  | 'pr-opened'
  | 'pr-stale'
  | 'memory-added'
  | 'memory-updated'
  | 'transcript-handoff'
  | 'transcript-failure'
  | 'connector-degraded';

/**
 * One curated item. The agent collects Finding[] from every connector,
 * scores them, filters, then renders to markdown grouped by source.
 */
export interface Finding {
  /** Stable hash of `source|kind|key|tsIso` — dedup key. */
  id: string;
  source: FindingSource;
  kind: FindingKind;
  /** Connector-supplied unique identifier within source. PR number as string,
   *  memory filename, transcript path, etc. */
  key: string;
  /** Single-line human-readable headline. ≤200 chars. */
  title: string;
  /** Optional 1-3 paragraph snippet. Phase 0 only includes structural metadata,
   *  no body content extraction. ≤2000 chars. */
  bodyExcerpt?: string;
  /** ISO8601 wall-clock timestamp the underlying event happened. */
  tsIso: string;
  /** Importance score 0..1. Computed by ImportanceScorer; higher = more important. */
  importance: number;
  /** Tags drawn from filename / labels / branch. Used by scorer + digest. */
  tags: readonly string[];
  /** Optional operator-clickable URL (PR HTML URL, agent-memory file path). */
  url?: string;
  /** Connector-supplied extra metadata. Opaque to scorer; used for digest formatting. */
  meta?: Record<string, string | number | boolean>;
}

/** A connector returns either findings, or an error annotation Finding. Never throws. */
export interface ConnectorResult {
  source: FindingSource;
  findings: readonly Finding[];
  /** ISO8601 of when the connector ran. */
  collectedAtIso: string;
  /** Optional warning emitted alongside findings (e.g. gh rate-limit hit). */
  warnings: readonly string[];
}

/** Connector contract — every source implements this. */
export interface Connector {
  readonly source: FindingSource;
  collect(args: CollectArgs): Promise<ConnectorResult>;
}

export interface CollectArgs {
  /** Lower bound — only emit findings with tsIso >= sinceIso. */
  sinceIso: string;
  /** Upper bound — only emit findings with tsIso <= untilIso. Defaults to now. */
  untilIso: string;
}

/** Importance scorer contract. Stateless, deterministic. */
export interface ImportanceScorer {
  score(finding: Omit<Finding, 'id' | 'importance'>, ctx: ScoringContext): number;
}

export interface ScoringContext {
  /** Earliest ts considered "fresh" — same as collect's sinceIso. */
  sinceIso: string;
  /** Now-ish — same as collect's untilIso. */
  untilIso: string;
}

/** Filter rule contract. Drops findings that don't pass. */
export interface FilterRule {
  /** Keep iff predicate returns true. */
  keep(f: Finding): boolean;
  /** Optional ordered cap — sort by importance desc, take first N. */
  cap?: number;
}

/** A digest's final output. */
export interface Digest {
  /** Rendered markdown, ≤ maxBytes. */
  markdown: string;
  /** Findings included after filtering, ordered as rendered. */
  findings: readonly Finding[];
  /** Findings dropped by filter (importance < floor or cap). Useful for tests. */
  dropped: readonly Finding[];
  /** Byte length of `markdown`. */
  sizeBytes: number;
  generatedAtIso: string;
  sinceIso: string;
  untilIso: string;
  /** Per-source counts and warnings for the digest header. */
  sourceSummary: Record<FindingSource, { collected: number; warnings: readonly string[] }>;
}

/** Filesystem read seam — every disk read goes through this (testable). */
export interface FsReader {
  exists(p: string): boolean;
  readFile(p: string): string;
  /** List entries in a dir; `[]` if missing. */
  readDir(p: string): string[];
  /** Stat-like info — only fields we use. `null` if missing. */
  stat(p: string): { isDirectory: boolean; isFile: boolean; sizeBytes: number; mtimeIso: string } | null;
}

/** Shell-out seam for `gh`. Tests inject a fake. */
export interface GhRunner {
  /**
   * Run `gh <args>` and return stdout. Throws on non-zero exit (caller
   * catches and converts to ConnectorResult.warnings).
   */
  run(args: readonly string[]): Promise<string>;
}

/** Git-log seam for memory deltas. Tests inject a fake. */
export interface GitRunner {
  /**
   * Run `git -C <repo> log <args>` and return stdout. Throws on non-zero exit.
   */
  log(repo: string, args: readonly string[]): Promise<string>;
}

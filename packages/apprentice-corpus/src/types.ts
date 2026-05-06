/**
 * @chiefaia/apprentice-corpus — shared types.
 *
 * Pipeline overview:
 *
 *   SourceReader[]  →  RawArtifact[]
 *                  →  InstructionPair[]    (normaliser)
 *                  →  dedupe
 *                  →  PII mask
 *                  →  quality score
 *                  →  distill (subprocess) for low-quality
 *                  →  cap @ maxSamples
 *                  →  write samples.jsonl + manifest.json
 *
 * The Option E shape: every CAIA-specific path/URL/topic is a constructor
 * parameter with a CAIA default; tests inject fixtures. See DESIGN.md for
 * the full architecture rationale.
 */

/** Tagged union of source kinds. */
export type SourceTag =
  | 'events'
  | 'memory'
  | 'reports'
  | 'langfuse'
  | 'github';

/** All recognised source tags — useful for `Object.keys` and exhaustive checks. */
export const ALL_SOURCE_TAGS: readonly SourceTag[] = Object.freeze([
  'events',
  'memory',
  'reports',
  'langfuse',
  'github'
]);

/**
 * A raw artifact from one source reader. The text payload is verbatim;
 * downstream stages (normaliser, PII masker) transform it. `kind` is
 * source-specific and opaque to the aggregator (e.g. memory → 'directive',
 * events → 'PRMerged'). The aggregator preserves it for routing in the
 * normaliser.
 */
export interface RawArtifact {
  source: SourceTag;
  /** File path / event id / trace id / PR number — must round-trip uniquely. */
  sourceId: string;
  /** Optional thread / correlation id for grouping related artifacts. */
  correlationId?: string;
  /** Source-specific kind tag (e.g. 'directive', 'PRMerged'). */
  kind?: string;
  /** Raw textual content (post-frontmatter strip if applicable). */
  text: string;
  /** Optional structured metadata preserved verbatim into meta sidecar. */
  sidecar?: Record<string, unknown>;
  /** Artifact creation time; reader's best estimate (mtime / event timestamp). */
  createdAtMs: number;
}

/**
 * One chat-completions turn in the OpenAI / MLX-LM format. The corpus is
 * shipped as one JSON object per line with a `messages` field that is a
 * 3-tuple (system, user, assistant) by default.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * One curated training pair. The `messages[]` field is the trainable
 * payload; everything else is metadata for audit + downstream filtering.
 */
export interface InstructionPair {
  /** Stable id (sha256 of messages content for determinism in tests). */
  id: string;
  messages: ChatMessage[];
  meta: {
    source: SourceTag;
    sourceId: string;
    correlationId?: string;
    kind?: string;
    qualityScore: number;
    distilled: boolean;
    redactedSpans: string[];
    createdAt: string;
    contentSha256: string;
  };
}

/** Reader context passed to every source reader. */
export interface ReaderContext {
  maxAgeDays: number;
  /** Caller's now() — injected for deterministic tests. */
  nowMs: number;
}

/** Common interface for all 5 source readers. */
export interface SourceReader {
  readonly source: SourceTag;
  read(ctx: ReaderContext): Promise<RawArtifact[]>;
}

/** Filesystem reader interface — injected so tests can fake it. */
export interface FsReader {
  exists(path: string): boolean;
  readDir(path: string): string[];
  readFile(path: string): string;
  stat(path: string): { mtimeMs: number; size: number; isFile: boolean };
}

/** Mentor event-bus client interface — injected so tests can fake it. */
export interface EventBusClient {
  /**
   * Read events newer than `sinceMs`. Returns chronologically
   * ascending. Implementations may bound the number of events
   * returned; the aggregator does not assume completeness.
   */
  readSince(sinceMs: number): Promise<EventBusRecord[]>;
}

/** Event bus record — minimal projection of `EmittedEvent`. */
export interface EventBusRecord {
  id: string;
  type: string;
  emittedAtMs: number;
  correlationId?: string;
  payload: Record<string, unknown>;
}

/** GitHub reader client — injected. */
export interface GithubClient {
  /**
   * List merged PRs with title + body + URL. Bounded by `sinceMs`.
   * Implementations should respect rate limits and emit warnings; if
   * rate-limited, return what was fetched so far.
   */
  listMergedPrs(sinceMs: number, repo: string): Promise<GithubPrRecord[]>;
}

/** GitHub PR record. */
export interface GithubPrRecord {
  number: number;
  title: string;
  body: string;
  url: string;
  mergedAtMs: number;
}

/** Langfuse client — injected. Phase-0 ships a stub that returns []. */
export interface LangfuseClient {
  listTraces(sinceMs: number, projectId: string): Promise<LangfuseTraceRecord[]>;
}

export interface LangfuseTraceRecord {
  id: string;
  name: string;
  input: string;
  output: string;
  createdAtMs: number;
}

/** Claude distiller — invoked for low-quality samples. Injected. */
export interface ClaudeDistiller {
  /**
   * Refine a raw artifact into a clean `{instruction, response}` pair.
   * Implementations must respect subscription-only billing — never the
   * pay-per-token API key path. Throws on rate-limit, timeout, missing
   * binary, or malformed output. The caller treats any throw as
   * "drop this sample"; do NOT throw across the whole pipeline.
   */
  distill(input: DistillInput): Promise<DistillOutput>;
}

export interface DistillInput {
  source: SourceTag;
  kind?: string;
  text: string;
}

export interface DistillOutput {
  instruction: string;
  response: string;
}

/** Manifest schema — version 1. */
export interface CorpusManifest {
  version: 1;
  generatedAt: string;
  outputDir: string;
  elapsedMs: number;
  totals: {
    rawArtifacts: number;
    afterDedup: number;
    afterPII: number;
    afterQuality: number;
    distilled: number;
    dropped: number;
    final: number;
  };
  perSource: Record<SourceTag, { artifacts: number; samples: number }>;
  redactedSpansHistogram: Record<string, number>;
  qualityHistogram: Record<string, number>;
  configSha256: string;
  warnings: string[];
}

/** Reason a candidate was dropped from the final corpus. */
export type DropReason =
  | 'too-short'
  | 'too-long'
  | 'duplicate'
  | 'low-quality-no-distill-budget'
  | 'distill-failed'
  | 'distill-still-low-quality'
  | 'no-instruction-extractable';

export interface DroppedRecord {
  source: SourceTag;
  sourceId: string;
  reason: DropReason;
  qualityScore?: number;
  errorMessage?: string;
}

/**
 * @caia/knowledge-graph-dispatch-hook — public type surface.
 *
 * Layer 3 of the AI-First Continuous-Discipline framework
 * (`research/ai_first_continuous_discipline_2026.md`).
 *
 * Contracts:
 *
 *   DispatchBrief   → minimal subset of @caia/policy-linter's DispatchContext
 *                     this layer cares about (briefMd + intent + repos).
 *   EnrichedBrief   → DispatchBrief with the AKG-injected preamble prepended
 *                     to briefMd, plus retrieval stats for observability.
 *   KgInjectionOpts → knobs: topK, threshold, kindMix, disabled, etc.
 *
 * Kept dependency-free (no `better-sqlite3` types, no embedder types) so
 * any caller can import these to declare the contract without dragging in
 * the runtime stack.
 */

/**
 * Brief-level intent classification. Mirrors `@caia/policy-linter`'s
 * `DispatchIntent` exactly so the two hooks compose cleanly on the same
 * DispatchContext.
 */
export type DispatchIntent =
  | 'research'
  | 'spec'
  | 'build'
  | 'review'
  | 'ops'
  | 'meta';

/**
 * The minimal brief-shaped subset this layer needs to operate. A caller
 * holding a `@caia/policy-linter` `DispatchContext` can pass it directly;
 * extra fields are ignored.
 */
export interface DispatchBrief {
  /** Caller agent identifier — echoed into stats + events. */
  callerAgentId: string;
  /** Full markdown body of the task brief. */
  briefMd: string;
  /** Brief-level intent classification. Used to bias kindMix. */
  intent: DispatchIntent;
  /** Optional repos the dispatch will touch — used as project filter. */
  targetRepos?: ReadonlyArray<string>;
  /** Optional explicit summary for embedding (defaults to briefMd head). */
  briefSummary?: string;
  /** Optional opaque metadata passed through unchanged. */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Per-kind retrieval mix. Slots are best-effort — if a kind has zero hits,
 * its slot rolls into the next kind in the order
 *   adr → principle → lesson → feedback → other
 * so total retrieved count tracks the sum without holes.
 *
 * Defaults match the Layer 3 spec (lines 651-672, 676):
 *   { adr: 3, principle: 1, lesson: 1, feedback: 1 }
 */
export interface KindMix {
  adr?: number;
  principle?: number;
  lesson?: number;
  feedback?: number;
  /** Catch-all bucket for non-standard artifact kinds. */
  other?: number;
}

/**
 * One retrieved artifact, kind-normalised and stripped to the fields the
 * preamble renderer needs. The raw `ArchSearchHit` is retained on `raw`
 * for callers that need richer payloads (metadata JSON, scores, etc).
 */
export interface RetrievedArtifact {
  /** Normalised kind: 'adr' | 'principle' | 'lesson' | 'feedback' | 'other'. */
  kind: 'adr' | 'principle' | 'lesson' | 'feedback' | 'other';
  /** Stable id (e.g. ADR-011, P3, L01, feedback-no-timelines). */
  id: string;
  /** Display title for the preamble line. */
  title: string;
  /** Optional date in YYYY-MM-DD form for feedback memories. */
  date?: string;
  /** Fused score from the AKG (RRF). Higher is better. */
  score: number;
  /** Raw hit payload — opaque to consumers. */
  raw: unknown;
}

/**
 * Knobs for one `injectContext` call. All fields optional.
 */
export interface KgInjectionOpts {
  /** Top-K total hits to surface. Default 5 (spec line 676). */
  topK?: number;
  /** Cosine threshold floor for dense hits. Default 0.6 (spec line 676). */
  threshold?: number;
  /** Per-kind retrieval mix; slot-rolls when a kind underflows. */
  kindMix?: KindMix;
  /** If true, the hook becomes a no-op — original brief returned unchanged. */
  disabled?: boolean;
  /** Force sparse-only retrieval (e.g. when Ollama is unavailable). */
  sparseOnly?: boolean;
  /** Force dense-only retrieval. */
  denseOnly?: boolean;
  /** Override the embedder-derived query string. */
  queryOverride?: string;
  /**
   * Max characters of `briefMd` to feed the embedder when no explicit
   * `briefSummary` is provided. Default 1200.
   */
  briefSummaryMaxChars?: number;
  /** Inject the preamble only; return original brief untouched on `brief`. */
  preambleOnly?: boolean;
}

/**
 * Per-call stats — surfaced on `EnrichedBrief.stats` and in
 * `context.injected` event payloads. Cheap to log.
 */
export interface KgInjectionStats {
  topK: number;
  threshold: number;
  embedderTokens: number;
  latencyMs: number;
  retrievedCount: number;
  sourcesByKind: Record<RetrievedArtifact['kind'], number>;
  fallbackUsed:
    | 'none'
    | 'sparse-only'
    | 'disabled'
    | 'empty-kg'
    | 'embedder-down';
}

/**
 * Result of `injectContext`. Composes cleanly back into a
 * `@caia/policy-linter` `DispatchContext` by spreading + overriding
 * `briefMd`.
 */
export interface EnrichedBrief {
  /** The brief to dispatch — preamble + original (or original if disabled). */
  brief: string;
  /** Preamble only, for separate logging / observability. */
  preamble: string;
  /** Retrieved artifacts the preamble was built from, ranked. */
  retrieved: ReadonlyArray<RetrievedArtifact>;
  /** Retrieval stats. */
  stats: KgInjectionStats;
  /** Caller agent id echoed unchanged. */
  callerAgentId: string;
}

/**
 * Event payload emitted on `context.injected` when an EventBus is wired.
 * Spec line 943: "Surfaces a `context.injected` event to the bus."
 */
export interface ContextInjectedEvent {
  callerAgentId: string;
  intent: DispatchIntent;
  stats: KgInjectionStats;
  /** Just the ids — full payloads stay on the EnrichedBrief, not the event. */
  retrievedIds: ReadonlyArray<string>;
}

export const CONTEXT_INJECTED = 'context.injected' as const;

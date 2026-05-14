/**
 * Mentor event-bus types.
 *
 * The event taxonomy is per `agent/memory/mentor_agent_directive.md`
 * (Phase 0 — Event-substrate prerequisites). 22 base + 8 A.10.4 = 30 types;
 * the taxonomy is extensible — add a new EventType + corresponding Zod
 * schema in schemas.ts and a payload type below.
 *
 * Append-only: never reorder or remove members of EVENT_TYPES. Consumers
 * persist the string literally; renames break historical events.
 */

/** All Mentor event types. */
export const EVENT_TYPES = [
  'PromptReceived',
  'PromptDecomposed',
  'TaskSpawned',
  'TaskCompleted',
  'TaskFailed',
  'TaskAborted',
  'OperatorCorrection',
  'OperatorAcknowledged',
  'PRMerged',
  'PRClosedWithoutMerge',
  'PostMergeBugReport',
  'RegressionDetected',
  'EvidenceGateFailure',
  'HallucinationFlagged',
  'ScopeMismatchFlagged',
  'DoDViolation',
  'MemoryWritten',
  'MemoryReadMissed',
  'DecisionClassifierTrip',
  'ToolMisuseFlagged',
  'SubscriptionBucketSpike',
  'CapabilityBrokerOverride',
  // ── A.10.4 — router / claude-adapter / chain-runner / spawner / optimizer ──
  'RouterDecision',
  'Compression',
  'ClaudeRequest',
  'ClaudeResponse',
  'ClaudeDuration',
  'ChainPhase',
  'SpawnerOutcome',
  'PromptOptimizerStage'
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Default schema version per type. Bump when the payload shape changes. */
export const DEFAULT_SCHEMA_VERSION = 1;

/** Stored event row (as persisted in the events SQLite table). */
export interface EventRow {
  id: string;
  event_type: EventType;
  schema_version: number;
  correlation_id: string | null;
  parent_event_id: string | null;
  emitted_at: string; // ISO 8601 UTC
  hostname: string;
  process_name: string | null;
  payload_json: string;
  validation_failed: 0 | 1;
  ingest_offset: number;
}

/** Decoded event with parsed payload. */
export interface EmittedEvent<TPayload = unknown> {
  id: string;
  type: EventType;
  schemaVersion: number;
  correlationId: string | null;
  parentEventId: string | null;
  emittedAt: string;
  hostname: string;
  processName: string | null;
  payload: TPayload;
  validationFailed: boolean;
  ingestOffset: number;
}

// ─── Per-event-type payload contracts ─────────────────────────────────────

export interface PromptReceivedPayload {
  promptId: string;
  body: string;
  source?: string;
}

export interface PromptDecomposedPayload {
  promptId: string;
  taskCount: number;
  taskIds: string[];
}

export interface TaskSpawnedPayload {
  taskId: string;
  parentTaskId?: string;
  agentName: string;
  promptId?: string;
}

export interface TaskCompletedPayload {
  taskId: string;
  durationMs: number;
  exitCode: number;
}

export interface TaskFailedPayload {
  taskId: string;
  error: string;
  exitCode?: number;
}

export interface TaskAbortedPayload {
  taskId: string;
  reason: string;
}

export interface OperatorCorrectionPayload {
  correctionText: string;
  context?: string;
  detectionMode: 'manual' | 'regex' | 'llm';
}

export interface OperatorAcknowledgedPayload {
  ackText: string;
  context?: string;
}

export interface PRMergedPayload {
  prNumber: number;
  sha: string;
  branch: string;
  repo?: string;
  author?: string;
}

export interface PRClosedWithoutMergePayload {
  prNumber: number;
  reason?: string;
}

export interface PostMergeBugReportPayload {
  prNumber?: number;
  description: string;
  reportedAt: string;
}

export interface RegressionDetectedPayload {
  testName: string;
  failedSha: string;
  passingSha?: string;
}

export interface EvidenceGateFailurePayload {
  prNumber: number;
  failedJobs: string[];
}

export interface HallucinationFlaggedPayload {
  taskId?: string;
  description: string;
  source: string;
}

export interface ScopeMismatchFlaggedPayload {
  taskId?: string;
  description: string;
}

export interface DoDViolationPayload {
  taskId?: string;
  rule: string;
  description: string;
}

export interface MemoryWrittenPayload {
  path: string;
  sha?: string;
  size: number;
  operation: 'create' | 'modify' | 'delete';
}

export interface MemoryReadMissedPayload {
  searchedFor: string;
  context?: string;
}

export interface DecisionClassifierTripPayload {
  decision: string;
  outcome: 'asked' | 'auto-decided';
}

export interface ToolMisuseFlaggedPayload {
  tool: string;
  description: string;
}

export interface SubscriptionBucketSpikePayload {
  bucket: string;
  spikeMagnitude: number;
}

export interface CapabilityBrokerOverridePayload {
  capability: string;
  reason: string;
  approver: string;
}

// ─── A.10.4 — router / claude-adapter / chain / spawner / optimizer ───────

/**
 * RouterDecision — emitted on every routing call inside local-llm-router.
 *
 * `displacementClass` is the operator-visible answer to "did this stay local?":
 *   - `local`              served by an Ollama model
 *   - `apprentice-canary`  served by a LoRA adapter via apprentice-override
 *   - `claude`             escalated to Anthropic Claude
 *   - `cached`             served from router output cache (no LLM call)
 *   - `fallback`           local intended → claude fallback after local error
 */
export interface RouterDecisionPayload {
  /** Router-internal decision id. Correlates Compression + Claude* siblings. */
  decisionId: string;
  /** Concrete model id chosen (e.g. `qwen2.5-coder:7b`, `claude-opus-4-7`). */
  modelChosen: string;
  /** Provider tier — keep stable, used as a cardinality-safe label. */
  provider: 'ollama' | 'apprentice' | 'claude' | 'cache' | 'other';
  displacementClass:
    | 'local'
    | 'apprentice-canary'
    | 'claude'
    | 'cached'
    | 'fallback';
  /** Wall-clock latency of the routing decision itself (not the LLM call). */
  latencyMs: number;
  /** Optional caia task-type label passed through the OpenAI-compat shim. */
  caiaTaskType?: string;
  /** Optional reason text (e.g. "below confidence threshold"). */
  reason?: string;
  /** Estimated cost in USD for this call. 0 for local. */
  estimatedCostUsd?: number;
  /** Cost the baseline (always-Claude) path would have charged — for displacement. */
  baselineCostUsd?: number;
}

/**
 * Compression — emitted by prompt-compaction / output-compaction passes.
 * One event per pass; the pass name identifies which stage compressed what.
 */
export interface CompressionPayload {
  /** Free-form stage label: `router.output`, `optimizer.stage2`, etc. */
  stage: string;
  inputChars: number;
  outputChars: number;
  /** outputChars / inputChars; 1.0 = no-op; <1 = shrinkage; >1 = expansion. */
  ratio: number;
  /** Compression algorithm: `passthrough`, `headroom`, `summarize`, `dedupe`. */
  method: 'passthrough' | 'headroom' | 'summarize' | 'dedupe' | 'other';
  /** Wall-clock cost of the compression itself. */
  durationMs?: number;
  /** If routed through an LLM-based compressor, the model used. */
  modelUsed?: string;
}

/**
 * ClaudeRequest — emitted *before* posting a request to api.anthropic.com.
 * Paired with ClaudeResponse + ClaudeDuration via `requestId`.
 *
 * `systemPromptHash` is sha256(systemPrompt).slice(0,16) — short enough for
 * the SQLite TEXT column, long enough that collisions are negligible per day.
 */
export interface ClaudeRequestPayload {
  requestId: string;
  model: string;
  /** sha256-prefix of the system prompt; collision-resistant in-day. */
  systemPromptHash: string;
  messageCount: number;
  /** Approximate input token count (estimated client-side, no /count call). */
  estimatedInputTokens?: number;
  /** Max output tokens requested. */
  maxTokens?: number;
  /** Whether prompt-cache headers (`cache_control`) are attached. */
  cachingEnabled?: boolean;
  /** Whether extended thinking is enabled. */
  thinkingEnabled?: boolean;
  /** Free-form label identifying the call site (e.g. `router`, `chain-runner`). */
  caller?: string;
}

/**
 * ClaudeResponse — emitted *after* a response is parsed from the API.
 * `tokenCount` is the canonical billed total (input + output + cached).
 */
export interface ClaudeResponsePayload {
  requestId: string;
  /** Total billed tokens (input + output + cache reads/writes). */
  tokenCount: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Cache-read input tokens (existing cache hit). */
  cacheReadInputTokens?: number;
  /** Cache-creation tokens (new cache entry). */
  cacheCreationInputTokens?: number;
  finishReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | 'error';
  /** Top-level Anthropic error code if `finishReason === 'error'`. */
  errorCode?: string;
  /** HTTP status code of the underlying call. */
  httpStatus?: number;
}

/**
 * ClaudeDuration — wall-clock pairing emitted at the end of every
 * ClaudeRequest/ClaudeResponse pair (success OR error). One per requestId.
 */
export interface ClaudeDurationPayload {
  requestId: string;
  /** ISO 8601 UTC at request start. */
  startTs: string;
  /** ISO 8601 UTC at response close (or error capture). */
  endTs: string;
  /** endTs - startTs in milliseconds. */
  wallMs: number;
  /** Whether the call ultimately succeeded (true) or errored (false). */
  ok: boolean;
}

/**
 * ChainPhase — emitted by chain-runner on every phase transition.
 * One event per state change (start, completion, failure, blocked, …).
 */
export interface ChainPhasePayload {
  chainId: string;
  /** Numeric phase id (per phases YAML). */
  phaseId: number;
  /** Phase status post-transition. */
  status:
    | 'pending'
    | 'in_progress'
    | 'done'
    | 'failed'
    | 'blocked'
    | 'aborted';
  /** Session id that owns this transition (matches lockfile owner). */
  sessionId?: string;
  /** Retry attempt number for this phase. */
  attempt?: number;
  /** Wall-clock duration if the phase ended (done/failed/aborted). */
  durationMs?: number;
  /** Failure classification (e.g. `rate_limited`, `auth_failure`, `timeout`). */
  failureClass?: string;
  /** Free-form reason text. */
  reason?: string;
}

/**
 * SpawnerOutcome — emitted by claude-spawner-agent at end of every spawn.
 * Cross-machine: `host` lets the mentor demux M1 vs M3 vs stolution-remote.
 */
export interface SpawnerOutcomePayload {
  /** Hostname of the spawning machine (`m3-prakash`, `stolution-remote`, …). */
  host: string;
  taskId: string;
  outcome:
    | 'completed'
    | 'failed'
    | 'aborted'
    | 'timeout'
    | 'pr-opened'
    | 'pr-merged';
  durationMs: number;
  exitCode?: number;
  /** Worktree path (helpful for forensics, optional). */
  worktreePath?: string;
  /** PR number if outcome ∈ {pr-opened, pr-merged}. */
  prNumber?: number;
  /** Free-form failure reason. */
  reason?: string;
}

/**
 * PromptOptimizerStage — emitted once per stage of the prompt-optimizer pipeline.
 * Stages run 1..N in order; each rewrites the prompt with a named transform.
 */
export interface PromptOptimizerStagePayload {
  /** Optimizer run id; groups all stages for one prompt. */
  runId: string;
  stageNumber: number;
  /** Transform applied at this stage (e.g. `claude-md-merge`, `dedupe`). */
  transform: string;
  tokensIn: number;
  tokensOut: number;
  /** Wall-clock cost of this stage. */
  durationMs?: number;
  /** True if the stage was a no-op (tokensIn === tokensOut and no rewrite). */
  noop?: boolean;
}

/** Maps EventType → its payload contract. */
export interface EventPayloadMap {
  PromptReceived: PromptReceivedPayload;
  PromptDecomposed: PromptDecomposedPayload;
  TaskSpawned: TaskSpawnedPayload;
  TaskCompleted: TaskCompletedPayload;
  TaskFailed: TaskFailedPayload;
  TaskAborted: TaskAbortedPayload;
  OperatorCorrection: OperatorCorrectionPayload;
  OperatorAcknowledged: OperatorAcknowledgedPayload;
  PRMerged: PRMergedPayload;
  PRClosedWithoutMerge: PRClosedWithoutMergePayload;
  PostMergeBugReport: PostMergeBugReportPayload;
  RegressionDetected: RegressionDetectedPayload;
  EvidenceGateFailure: EvidenceGateFailurePayload;
  HallucinationFlagged: HallucinationFlaggedPayload;
  ScopeMismatchFlagged: ScopeMismatchFlaggedPayload;
  DoDViolation: DoDViolationPayload;
  MemoryWritten: MemoryWrittenPayload;
  MemoryReadMissed: MemoryReadMissedPayload;
  DecisionClassifierTrip: DecisionClassifierTripPayload;
  ToolMisuseFlagged: ToolMisuseFlaggedPayload;
  SubscriptionBucketSpike: SubscriptionBucketSpikePayload;
  CapabilityBrokerOverride: CapabilityBrokerOverridePayload;
  RouterDecision: RouterDecisionPayload;
  Compression: CompressionPayload;
  ClaudeRequest: ClaudeRequestPayload;
  ClaudeResponse: ClaudeResponsePayload;
  ClaudeDuration: ClaudeDurationPayload;
  ChainPhase: ChainPhasePayload;
  SpawnerOutcome: SpawnerOutcomePayload;
  PromptOptimizerStage: PromptOptimizerStagePayload;
}

/** Type-safe payload for a given EventType. */
export type PayloadOf<T extends EventType> = EventPayloadMap[T];

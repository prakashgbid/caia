/**
 * Zod schemas for each EventType payload.
 *
 * The schemas serve two purposes:
 *   1. emit-time validation — payload checked before it's persisted.
 *   2. introspection / cross-language consumers — schemas are persisted
 *      into the `schema_definitions` SQLite table at SDK init time so
 *      a future Python Mentor can read the canonical contract.
 *
 * Adding a new event type:
 *   1. Add it to EVENT_TYPES in types.ts
 *   2. Add the payload interface in types.ts
 *   3. Add the Zod schema below + register in EVENT_SCHEMAS
 *   4. Bump the schema_version on existing types only when payload changes
 */

import { z } from 'zod';
import { EVENT_TYPES, type EventType } from './types.js';

// ─── Per-event schemas ────────────────────────────────────────────────────

export const PromptReceivedSchema = z.object({
  promptId: z.string().min(1),
  body: z.string(),
  source: z.string().optional()
});

export const PromptDecomposedSchema = z.object({
  promptId: z.string().min(1),
  taskCount: z.number().int().nonnegative(),
  taskIds: z.array(z.string())
});

export const TaskSpawnedSchema = z.object({
  taskId: z.string().min(1),
  parentTaskId: z.string().optional(),
  agentName: z.string().min(1),
  promptId: z.string().optional()
});

export const TaskCompletedSchema = z.object({
  taskId: z.string().min(1),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int()
});

export const TaskFailedSchema = z.object({
  taskId: z.string().min(1),
  error: z.string(),
  exitCode: z.number().int().optional()
});

export const TaskAbortedSchema = z.object({
  taskId: z.string().min(1),
  reason: z.string()
});

export const OperatorCorrectionSchema = z.object({
  correctionText: z.string().min(1),
  context: z.string().optional(),
  detectionMode: z.enum(['manual', 'regex', 'llm'])
});

export const OperatorAcknowledgedSchema = z.object({
  ackText: z.string().min(1),
  context: z.string().optional()
});

export const PRMergedSchema = z.object({
  prNumber: z.number().int().positive(),
  sha: z.string().regex(/^[0-9a-f]{7,40}$/),
  branch: z.string().min(1),
  repo: z.string().optional(),
  author: z.string().optional()
});

export const PRClosedWithoutMergeSchema = z.object({
  prNumber: z.number().int().positive(),
  reason: z.string().optional()
});

export const PostMergeBugReportSchema = z.object({
  prNumber: z.number().int().positive().optional(),
  description: z.string().min(1),
  reportedAt: z.string()
});

export const RegressionDetectedSchema = z.object({
  testName: z.string().min(1),
  failedSha: z.string().regex(/^[0-9a-f]{7,40}$/),
  passingSha: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/)
    .optional()
});

export const EvidenceGateFailureSchema = z.object({
  prNumber: z.number().int().positive(),
  failedJobs: z.array(z.string()).min(1)
});

export const HallucinationFlaggedSchema = z.object({
  taskId: z.string().optional(),
  description: z.string().min(1),
  source: z.string().min(1)
});

export const ScopeMismatchFlaggedSchema = z.object({
  taskId: z.string().optional(),
  description: z.string().min(1)
});

export const DoDViolationSchema = z.object({
  taskId: z.string().optional(),
  rule: z.string().min(1),
  description: z.string().min(1)
});

export const MemoryWrittenSchema = z.object({
  path: z.string().min(1),
  sha: z.string().optional(),
  size: z.number().int().nonnegative(),
  operation: z.enum(['create', 'modify', 'delete'])
});

export const MemoryReadMissedSchema = z.object({
  searchedFor: z.string().min(1),
  context: z.string().optional()
});

export const DecisionClassifierTripSchema = z.object({
  decision: z.string().min(1),
  outcome: z.enum(['asked', 'auto-decided'])
});

export const ToolMisuseFlaggedSchema = z.object({
  tool: z.string().min(1),
  description: z.string().min(1)
});

export const SubscriptionBucketSpikeSchema = z.object({
  bucket: z.string().min(1),
  spikeMagnitude: z.number()
});

export const CapabilityBrokerOverrideSchema = z.object({
  capability: z.string().min(1),
  reason: z.string().min(1),
  approver: z.string().min(1)
});

// ─── A.10.4 — router / claude-adapter / chain / spawner / optimizer ───────

export const RouterDecisionSchema = z.object({
  decisionId: z.string().min(1),
  modelChosen: z.string().min(1),
  provider: z.enum(['ollama', 'apprentice', 'claude', 'cache', 'other']),
  displacementClass: z.enum([
    'local',
    'apprentice-canary',
    'claude',
    'cached',
    'fallback'
  ]),
  latencyMs: z.number().nonnegative(),
  caiaTaskType: z.string().optional(),
  reason: z.string().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
  baselineCostUsd: z.number().nonnegative().optional()
});

export const CompressionSchema = z.object({
  stage: z.string().min(1),
  inputChars: z.number().int().nonnegative(),
  outputChars: z.number().int().nonnegative(),
  ratio: z.number().nonnegative(),
  method: z.enum(['passthrough', 'headroom', 'summarize', 'dedupe', 'other']),
  durationMs: z.number().nonnegative().optional(),
  modelUsed: z.string().optional()
});

export const ClaudeRequestSchema = z.object({
  requestId: z.string().min(1),
  model: z.string().min(1),
  systemPromptHash: z.string().regex(/^[0-9a-f]{8,64}$/),
  messageCount: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative().optional(),
  maxTokens: z.number().int().positive().optional(),
  cachingEnabled: z.boolean().optional(),
  thinkingEnabled: z.boolean().optional(),
  caller: z.string().optional()
});

export const ClaudeResponseSchema = z.object({
  requestId: z.string().min(1),
  tokenCount: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  cacheReadInputTokens: z.number().int().nonnegative().optional(),
  cacheCreationInputTokens: z.number().int().nonnegative().optional(),
  finishReason: z.enum([
    'end_turn',
    'max_tokens',
    'stop_sequence',
    'tool_use',
    'error'
  ]),
  errorCode: z.string().optional(),
  httpStatus: z.number().int().min(100).max(599).optional()
});

export const ClaudeDurationSchema = z.object({
  requestId: z.string().min(1),
  startTs: z.string().datetime({ offset: true }),
  endTs: z.string().datetime({ offset: true }),
  wallMs: z.number().nonnegative(),
  ok: z.boolean()
});

export const ChainPhaseSchema = z.object({
  chainId: z.string().min(1),
  phaseId: z.number().int().nonnegative(),
  status: z.enum([
    'pending',
    'in_progress',
    'done',
    'failed',
    'blocked',
    'aborted'
  ]),
  sessionId: z.string().optional(),
  attempt: z.number().int().nonnegative().optional(),
  durationMs: z.number().nonnegative().optional(),
  failureClass: z.string().optional(),
  reason: z.string().optional()
});

export const SpawnerOutcomeSchema = z.object({
  host: z.string().min(1),
  taskId: z.string().min(1),
  outcome: z.enum([
    'completed',
    'failed',
    'aborted',
    'timeout',
    'pr-opened',
    'pr-merged'
  ]),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().int().optional(),
  worktreePath: z.string().optional(),
  prNumber: z.number().int().positive().optional(),
  reason: z.string().optional()
});

export const PromptOptimizerStageSchema = z.object({
  runId: z.string().min(1),
  stageNumber: z.number().int().positive(),
  transform: z.string().min(1),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative().optional(),
  noop: z.boolean().optional()
});

// ─── Registry ─────────────────────────────────────────────────────────────

export const EVENT_SCHEMAS: { [K in EventType]: z.ZodTypeAny } = {
  PromptReceived: PromptReceivedSchema,
  PromptDecomposed: PromptDecomposedSchema,
  TaskSpawned: TaskSpawnedSchema,
  TaskCompleted: TaskCompletedSchema,
  TaskFailed: TaskFailedSchema,
  TaskAborted: TaskAbortedSchema,
  OperatorCorrection: OperatorCorrectionSchema,
  OperatorAcknowledged: OperatorAcknowledgedSchema,
  PRMerged: PRMergedSchema,
  PRClosedWithoutMerge: PRClosedWithoutMergeSchema,
  PostMergeBugReport: PostMergeBugReportSchema,
  RegressionDetected: RegressionDetectedSchema,
  EvidenceGateFailure: EvidenceGateFailureSchema,
  HallucinationFlagged: HallucinationFlaggedSchema,
  ScopeMismatchFlagged: ScopeMismatchFlaggedSchema,
  DoDViolation: DoDViolationSchema,
  MemoryWritten: MemoryWrittenSchema,
  MemoryReadMissed: MemoryReadMissedSchema,
  DecisionClassifierTrip: DecisionClassifierTripSchema,
  ToolMisuseFlagged: ToolMisuseFlaggedSchema,
  SubscriptionBucketSpike: SubscriptionBucketSpikeSchema,
  CapabilityBrokerOverride: CapabilityBrokerOverrideSchema,
  RouterDecision: RouterDecisionSchema,
  Compression: CompressionSchema,
  ClaudeRequest: ClaudeRequestSchema,
  ClaudeResponse: ClaudeResponseSchema,
  ClaudeDuration: ClaudeDurationSchema,
  ChainPhase: ChainPhaseSchema,
  SpawnerOutcome: SpawnerOutcomeSchema,
  PromptOptimizerStage: PromptOptimizerStageSchema
};

/**
 * Sanity check: enforce that every EventType has a schema.
 * Imported in tests to assert no entry is missed.
 */
export function assertEverySchemaPresent(): void {
  for (const t of EVENT_TYPES) {
    if (!(t in EVENT_SCHEMAS)) {
      throw new Error(`Missing schema for event type: ${t}`);
    }
  }
}

/**
 * Validate a payload against the schema for an event type.
 * Returns parsed value on success, error on failure (DOES NOT throw).
 */
export function validatePayload<T extends EventType>(
  type: T,
  payload: unknown
):
  | { ok: true; value: unknown }
  | { ok: false; error: z.ZodError } {
  const schema = EVENT_SCHEMAS[type];
  const result = schema.safeParse(payload);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error };
}

/**
 * Serialize a Zod schema to a string suitable for storage in the
 * `schema_definitions` table. We just JSON.stringify the schema's
 * `_def` shape — good enough for introspection; not a round-trippable
 * serialization (Zod is not natively serializable).
 */
export function describeSchema(schema: z.ZodTypeAny): string {
  try {
    return JSON.stringify(schema._def, replacer);
  } catch {
    return '{}';
  }
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'function') return '[function]';
  if (value instanceof RegExp) return value.source;
  return value;
}

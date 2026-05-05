/**
 * Mentor event-bus types.
 *
 * The event taxonomy is per `agent/memory/mentor_agent_directive.md`
 * (Phase 0 — Event-substrate prerequisites). 22 event types initially;
 * the taxonomy is extensible — add a new EventType + corresponding Zod
 * schema in schemas.ts and a payload type below.
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
  'CapabilityBrokerOverride'
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
}

/** Type-safe payload for a given EventType. */
export type PayloadOf<T extends EventType> = EventPayloadMap[T];

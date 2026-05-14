/**
 * @chiefaia/mentor-event-bus — Mentor Phase 0 typed event substrate.
 *
 * Producers: import Client + emit. Consumers (Mentor / Curator / Steward):
 * import Client + getRecent + queryEvents.
 *
 * Cross-machine: import HttpClient + emit (PR-β). The HTTP path POSTs to
 * a same-package server (`startServer`) running on the machine that owns
 * the events.sqlite (Mac-side at deploy time per design).
 *
 * See packages/mentor-event-bus/README.md for usage examples.
 */

export {
  Client,
  type ClientOptions,
  type EmitOptions
} from './client.js';

export {
  withCorrelation,
  withCorrelationAsync,
  currentCorrelation,
  currentCorrelationId,
  currentParentEventId
} from './correlation.js';

export {
  EVENT_TYPES,
  DEFAULT_SCHEMA_VERSION,
  type EventType,
  type EventRow,
  type EmittedEvent,
  type EventPayloadMap,
  type PayloadOf,
  type PromptReceivedPayload,
  type PromptDecomposedPayload,
  type TaskSpawnedPayload,
  type TaskCompletedPayload,
  type TaskFailedPayload,
  type TaskAbortedPayload,
  type OperatorCorrectionPayload,
  type OperatorAcknowledgedPayload,
  type PRMergedPayload,
  type PRClosedWithoutMergePayload,
  type PostMergeBugReportPayload,
  type RegressionDetectedPayload,
  type EvidenceGateFailurePayload,
  type HallucinationFlaggedPayload,
  type ScopeMismatchFlaggedPayload,
  type DoDViolationPayload,
  type MemoryWrittenPayload,
  type MemoryReadMissedPayload,
  type DecisionClassifierTripPayload,
  type ToolMisuseFlaggedPayload,
  type SubscriptionBucketSpikePayload,
  type CapabilityBrokerOverridePayload,
  type RouterDecisionPayload,
  type CompressionPayload,
  type ClaudeRequestPayload,
  type ClaudeResponsePayload,
  type ClaudeDurationPayload,
  type ChainPhasePayload,
  type SpawnerOutcomePayload,
  type PromptOptimizerStagePayload
} from './types.js';

export {
  EVENT_SCHEMAS,
  validatePayload,
  describeSchema,
  assertEverySchemaPresent
} from './schemas.js';

export {
  openDatabase,
  insertEvent,
  queryEvents,
  countEvents,
  registerSchemaDefinition,
  type InsertEventArgs,
  type QueryEventsOptions
} from './sqlite.js';

// PR-β: HTTP server + client + auth helpers.
export {
  signRequest,
  verifyRequest,
  loadSecret,
  TIMESTAMP_HEADER,
  SIGNATURE_HEADER,
  DEFAULT_REPLAY_WINDOW_MS,
  type VerifyResult
} from './auth.js';

export {
  startServer,
  MAX_BODY_BYTES,
  type ServerOptions,
  type RunningServer
} from './server.js';

export {
  HttpClient,
  httpEmitOnce,
  assertEverySchemaForHttp,
  type HttpClientOptions,
  type HttpEmitOptions,
  type HttpEmitResult
} from './http-client.js';

// PR-δ: MemoryWritten emit-point (chokidar-style fs.watch daemon).
export {
  startMemoryWatcher,
  defaultFilter,
  type WatchMemoryOptions,
  type MemoryWatcher
} from './memory-watcher.js';

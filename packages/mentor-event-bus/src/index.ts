/**
 * @chiefaia/mentor-event-bus — Mentor Phase 0 typed event substrate.
 *
 * Producers: import Client + emit. Consumers (Mentor / Curator / Steward):
 * import Client + getRecent + queryEvents.
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
  type CapabilityBrokerOverridePayload
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

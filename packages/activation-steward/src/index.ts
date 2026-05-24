/**
 * @caia/activation-steward — public API.
 *
 * Spec: research/real_definition_of_done_enforcement_2026.md §4.2 + §12 A5.
 */

export * from './types.js';

export {
  // Backends
  NullBackend,
  MockBackend,
  TempoBackend,
  JaegerBackend,
  // Aggregation primitives
  aggregateBySpanName,
  aggregateByTenant,
  probeTelemetry,
  type TraceBackend,
  type SpanAggregate,
  type TempoBackendOptions,
  type JaegerBackendOptions,
  type MockBackendOptions,
} from './trace-collector.js';

export {
  loadDeployManifest,
  loadPackageExpectations,
  loadPackageExpectation,
  joinManifestAndExpectations,
} from './manifest.js';

export {
  crossCheck,
  crossCheckFromMatches,
  callpathKey,
  type CrossCheckOptions,
} from './manifest-cross-check.js';

export {
  partitionByTenant,
  buildAttestationMatrix,
  classifyCell,
  getCell,
  countByStatus,
  type BuildMatrixOptions,
} from './per-tenant-isolation.js';

export {
  appendRun,
  writeStatusSnapshot,
  readStatusSnapshot,
  loadRecentRuns,
  buildRunRow,
  buildStatusSnapshot,
  flattenForPostgres,
  classify,
  type CallpathAttestationRow,
  type BuildRunRowOptions,
} from './attestation.js';

export {
  reportToInbox,
  reportToEventBus,
  reportToStateMachine,
  type InboxAppendResult,
  type EventBusEmitResult,
} from './reporter.js';

export { run } from './run.js';

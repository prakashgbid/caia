/**
 * @caia/outcome-steward — public API.
 *
 * Real-DoD Layer 3 — Prometheus / Grafana metric verifier. Confirms
 * every merged package's declared SLI/metric is non-zero AND trending
 * in the declared direction within the freshness window.
 *
 * Spec: research/real_definition_of_done_enforcement_2026.md §4.3 + §12 A8.
 *
 * Sibling of:
 *   - @chiefaia/deploy-steward (Layer 1: declared = shipped)
 *   - @caia/activation-steward (Layer 2: declared paths get called)
 *   - @caia/usage-steward      (Layer 3 sibling: declared imports get used)
 */

export * from './types.js';

export {
  NullBackend,
  MockBackend,
  PrometheusBackend,
  GrafanaBackend,
  computeSlope,
  compareThreshold,
  classifyTrend,
  trendSatisfied,
  defaultStepSeconds,
  pickMostRecent,
  probeBackend,
  type MetricBackend,
  type PrometheusBackendOptions,
  type GrafanaBackendOptions,
  type MockBackendOptions,
} from './metric-collector.js';

export {
  loadDeployManifest,
  loadPackageExpectations,
  loadPackageExpectation,
  joinManifestAndExpectations,
} from './manifest.js';

export {
  crossCheck,
  crossCheckFromSeries,
  sliKey,
  type CrossCheckOptions,
} from './manifest-cross-check.js';

export {
  buildAttestationMatrix,
  classifyCell,
  getCell,
  countByStatus,
  type BuildMatrixOptions,
} from './matrix.js';

export {
  appendRun,
  writeStatusSnapshot,
  appendGreenAttestations,
  readStatusSnapshot,
  loadRecentRuns,
  loadGreenAttestations,
  buildRunRow,
  buildStatusSnapshot,
  buildGreenAttestations,
  flattenForPostgres,
  classify,
  type BuildRunRowOptions,
  type OutcomeAttestationRow,
} from './attestation.js';

export {
  reportToInbox,
  reportToEventBus,
  reportToStateMachine,
  summariseGreenAttestations,
  type InboxAppendResult,
  type EventBusEmitResult,
} from './reporter.js';

export { run } from './run.js';

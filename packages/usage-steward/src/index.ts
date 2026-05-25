/**
 * @caia/usage-steward — public API.
 *
 * Spec: research/real_definition_of_done_enforcement_2026.md §4.1 + §12 Task A4.
 */

export * from './types.js';

export {
  ALL_SCANNERS,
  defaultScannerRunner,
  runAllScanners,
  // Scanner wrappers
  runKnip, parseKnipJson,
  runDepcheck, parseDepcheckJson,
  runTsPrune, parseTsPruneOutput,
  runDependencyCruiser, parseDepCruiserJson,
  // Spawn helpers (exported for advanced callers / tests)
  probeBinary, runBinary, tail,
} from './scanners/index.js';

export {
  loadDeployManifest,
  loadPackageExpectations,
  loadPackageExpectation,
  joinManifestAndExpectations,
  declaredShippedNames,
} from './manifest.js';

export {
  crossCheckPackage,
  buildAttestationMatrix,
  classifyCell,
  countByStatus,
  type CrossCheckInput,
  type CrossCheckOptions,
} from './manifest-cross-check.js';

export {
  appendRun,
  writeStatusSnapshot,
  readStatusSnapshot,
  loadRecentRuns,
  buildRunRow,
  buildStatusSnapshot,
  flattenForPostgres,
  classify,
  appendGreenIds,
  loadAttestedGreenSet,
  computeNewGreenIds,
  greenKey,
  type BuildRunRowOptions,
  type GreenIdEntry,
  type PgAttestationRow,
} from './attestation.js';

export {
  reportToInbox,
  reportToEventBus,
  reportToStateMachine,
  type InboxAppendResult,
  type EventBusEmitResult,
} from './reporter.js';

export { run } from './run.js';

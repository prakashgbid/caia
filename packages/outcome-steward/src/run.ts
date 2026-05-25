/**
 * Top-level orchestrator for the outcome-steward.
 *
 * Glues all the modules:
 *   manifest    → expected SLIs per package
 *   backend     → metric series
 *   cross-check → joined per-(package, solution, sli) rows
 *   matrix      → attestation matrix
 *   attestation → JSONL + status snapshot + green-id roll-up
 *   reporter    → INBOX + event-bus + state-machine
 *
 * Safe to call without arguments: defaults are tuned for the operator's
 * machine, but every path is overridable for tests + alternate sites.
 *
 * Spec: research/real_definition_of_done_enforcement_2026.md §4.3 + §12 A8.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendGreenAttestations,
  appendRun,
  buildGreenAttestations,
  buildRunRow,
  buildStatusSnapshot,
  writeStatusSnapshot,
} from './attestation.js';
import { crossCheck } from './manifest-cross-check.js';
import {
  joinManifestAndExpectations,
  loadDeployManifest,
  loadPackageExpectations,
} from './manifest.js';
import { buildAttestationMatrix, countByStatus } from './matrix.js';
import { NullBackend, probeBackend } from './metric-collector.js';
import { reportToEventBus, reportToInbox } from './reporter.js';
import type {
  BackendState,
  OutcomeEvent,
  RunOpts,
  RunResult,
} from './types.js';

const HOME = os.homedir();
const DEFAULTS = {
  deployManifestPath: path.join(HOME, 'Documents/projects/agent-memory/deploy_manifest.yaml'),
  packagesRoot: path.join(HOME, 'Documents/projects/caia/packages'),
  runsJsonlPath: path.join(HOME, '.caia/outcome-steward/runs.jsonl'),
  statusJsonPath: path.join(HOME, '.caia/outcome-steward/status.json'),
  attestationsJsonlPath: path.join(HOME, '.caia/outcome-steward/attestations.jsonl'),
  inboxPath: path.join(HOME, 'Documents/projects/agent-memory/INBOX.md'),
  windowHours: 24,
  site: 'caia-mac',
};

export async function run(opts: RunOpts = {}): Promise<RunResult> {
  const startedAt = (opts.now ?? (() => new Date()))();
  const backend = opts.backend ?? new NullBackend();
  const site = opts.site ?? DEFAULTS.site;
  const windowHours = opts.windowHours ?? DEFAULTS.windowHours;
  const inboxPath = opts.inboxPath ?? DEFAULTS.inboxPath;
  const runsJsonlPath = opts.runsJsonlPath ?? DEFAULTS.runsJsonlPath;
  const statusJsonPath = opts.statusJsonPath ?? DEFAULTS.statusJsonPath;
  const attestationsJsonlPath = opts.attestationsJsonlPath ?? DEFAULTS.attestationsJsonlPath;
  const deployManifestPath = opts.deployManifestPath ?? DEFAULTS.deployManifestPath;
  const packagesRoot = opts.packagesRoot ?? DEFAULTS.packagesRoot;
  const emit = opts.emit ?? noopEmit;

  // 1. Backend probe — first thing we do. If absent, short-circuit
  //    to a no-metric-store run (the spec's graceful-degradation contract).
  const backendState: BackendState = await probeBackend(backend);

  // 2. Load expectations + manifest in parallel.
  const [manifest, allExpectations] = await Promise.all([
    loadDeployManifest(deployManifestPath),
    loadPackageExpectations(packagesRoot),
  ]);
  const joined = joinManifestAndExpectations(manifest, allExpectations);

  // 3. Cross-check. If backend is absent, skip the network entirely
  //    but still emit synthetic rows so the matrix is populated.
  let crossCheckRows;
  if (backendState === 'absent') {
    // synthetic results — empty series for every (package, sli).
    const { crossCheckFromSeries } = await import('./manifest-cross-check.js');
    crossCheckRows = crossCheckFromSeries(joined, new Map());
  } else {
    crossCheckRows = await crossCheck(backend, joined, { now: () => startedAt });
  }

  // 4. Build attestation matrix.
  const matrix = buildAttestationMatrix(crossCheckRows, { backend: backendState });

  // 5. Build run row + status snapshot + green attestations.
  const finishedAt = (opts.now ?? (() => new Date()))();
  const runRow = buildRunRow({
    startedAt,
    finishedAt,
    site,
    backend: backendState,
    windowHours,
    matrix,
  });
  const snapshot = buildStatusSnapshot(runRow, matrix);
  const green = buildGreenAttestations(runRow, matrix);

  // 6. Persist + report.
  let inboxAppended = false;
  let eventsEmitted = 0;
  if (!opts.dryRun) {
    await appendRun(runsJsonlPath, runRow);
    await writeStatusSnapshot(statusJsonPath, snapshot);
    if (green.length > 0) {
      await appendGreenAttestations(attestationsJsonlPath, green);
    }
    const inbox = await reportToInbox(inboxPath, runRow, matrix);
    inboxAppended = inbox.appended;
    const bus = reportToEventBus(emit, runRow, matrix);
    eventsEmitted = bus.eventsEmitted;
  }

  if (!opts.quiet) {
    const counts = countByStatus(matrix);
    console.log(
      `[outcome-steward] run=${runRow.runId} site=${site} backend=${backendState} ` +
        `green=${counts.green} yellow=${counts.yellow} red=${counts.red} ` +
        `no-metric-declared=${counts['no-metric-declared']} ` +
        `no-metric-store=${counts['no-metric-store']} unknown=${counts.unknown}`,
    );
  }

  return {
    run: runRow,
    matrix,
    greenCount: green.length,
    inboxAppended,
    eventsEmitted,
  };
}

function noopEmit(_event: OutcomeEvent): void {
  /* no-op */
}

/**
 * Top-level orchestrator for the activation-steward.
 *
 * Glues all the modules:
 *   manifest    → expected call-paths per package
 *   backend     → trace data
 *   cross-check → joined per-(package, tenant, callpath) rows
 *   per-tenant  → attestation matrix
 *   attestation → JSONL + status snapshot
 *   reporter    → INBOX + event-bus + state-machine
 *
 * Safe to call without arguments: defaults are tuned for the operator's
 * machine, but every path is overridable for tests + alternate sites.
 */

import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendRun,
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
import {
  buildAttestationMatrix,
  countByStatus,
} from './per-tenant-isolation.js';
import {
  reportToEventBus,
  reportToInbox,
} from './reporter.js';
import { NullBackend, probeTelemetry } from './trace-collector.js';
import type {
  ActivationEvent,
  PackageExpectations,
  RunOpts,
  RunResult,
  TelemetryState,
} from './types.js';

const HOME = os.homedir();
const DEFAULTS = {
  deployManifestPath: path.join(HOME, 'Documents/projects/agent-memory/deploy_manifest.yaml'),
  packagesRoot: path.join(HOME, 'Documents/projects/caia/packages'),
  runsJsonlPath: path.join(HOME, '.caia/activation-steward/runs.jsonl'),
  statusJsonPath: path.join(HOME, '.caia/activation-steward/status.json'),
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
  const deployManifestPath = opts.deployManifestPath ?? DEFAULTS.deployManifestPath;
  const packagesRoot = opts.packagesRoot ?? DEFAULTS.packagesRoot;
  const emit = opts.emit ?? noopEmit;

  // 1. Telemetry probe — first thing we do. If absent, short-circuit
  //    to a no-telemetry run (the spec's graceful-degradation contract).
  const telemetry: TelemetryState = await probeTelemetry(backend);

  // 2. Load expectations + manifest.
  const [manifest, allExpectations] = await Promise.all([
    loadDeployManifest(deployManifestPath),
    loadPackageExpectations(packagesRoot),
  ]);
  const joined = joinManifestAndExpectations(manifest, allExpectations);
  const packages: ReadonlyArray<PackageExpectations> = joined.map((j) => j.expectations);

  // 3. Cross-check. If telemetry is absent we skip the backend query
  //    (NullBackend returns [] anyway, but skipping avoids confusing
  //    log lines on a fresh-site first run).
  const results = telemetry === 'absent' ? [] : await crossCheck(backend, packages, { now: () => startedAt });

  // 4. Build attestation matrix.
  const matrix = buildAttestationMatrix(results, { telemetry, packages });

  // 5. Build the run row + status snapshot.
  const finishedAt = (opts.now ?? (() => new Date()))();
  const runRow = buildRunRow({ startedAt, finishedAt, site, telemetry, windowHours, matrix });
  const snapshot = buildStatusSnapshot(runRow, matrix);

  // 6. Persist + report.
  let inboxAppended = false;
  let eventsEmitted = 0;
  if (!opts.dryRun) {
    await appendRun(runsJsonlPath, runRow);
    await writeStatusSnapshot(statusJsonPath, snapshot);
    const inbox = await reportToInbox(inboxPath, runRow, matrix);
    inboxAppended = inbox.appended;
    const bus = reportToEventBus(emit, runRow, matrix);
    eventsEmitted = bus.eventsEmitted;
  }

  if (!opts.quiet) {
    const counts = countByStatus(matrix);
    // eslint-disable-next-line no-console
    console.log(
      `[activation-steward] run=${runRow.runId} site=${site} telemetry=${telemetry} ` +
        `green=${counts.green} yellow=${counts.yellow} red=${counts.red} ` +
        `no-telemetry=${counts['no-telemetry']} unknown=${counts.unknown}`,
    );
  }

  return {
    run: runRow,
    matrix,
    inboxAppended,
    eventsEmitted,
  };
}

function noopEmit(_event: ActivationEvent): void {
  /* no-op */
}

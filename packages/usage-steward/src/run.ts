/**
 * Top-level orchestrator for the usage-steward.
 *
 * Glues every module:
 *   manifest       → expected imports/exports per package
 *   scanners       → knip + depcheck + ts-prune + dependency-cruiser
 *   cross-check    → per-(package) AttestationCell
 *   attestation    → JSONL audit + status snapshot + green-id list
 *   reporter       → INBOX + event-bus + state-machine
 *
 * Safe to call with no arguments: defaults are tuned for the operator's
 * Mac, but every path is overridable for tests + alternate sites.
 */
import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendGreenIds, appendRun, buildRunRow, buildStatusSnapshot,
  computeNewGreenIds, loadAttestedGreenSet, writeStatusSnapshot,
} from './attestation.js';
import { buildAttestationMatrix, countByStatus, crossCheckPackage } from './manifest-cross-check.js';
import { joinManifestAndExpectations, loadDeployManifest, loadPackageExpectations } from './manifest.js';
import { reportToEventBus, reportToInbox } from './reporter.js';
import { ALL_SCANNERS, defaultScannerRunner } from './scanners/index.js';
import type {
  AttestationCell, RunOpts, RunResult, ScannerKind, ScannerResult, ScannerToolingState, UsageEvent,
} from './types.js';

const HOME = os.homedir();
const DEFAULTS = {
  deployManifestPath: path.join(HOME, 'Documents/projects/agent-memory/deploy_manifest.yaml'),
  packagesRoot: path.join(HOME, 'Documents/projects/caia/packages'),
  runsJsonlPath: path.join(HOME, '.caia/usage-steward/runs.jsonl'),
  statusJsonPath: path.join(HOME, '.caia/usage-steward/status.json'),
  attestationsJsonlPath: path.join(HOME, '.caia/usage-steward/attestations.jsonl'),
  inboxPath: path.join(HOME, 'Documents/projects/agent-memory/INBOX.md'),
  site: 'caia-mac',
};

export async function run(opts: RunOpts = {}): Promise<RunResult> {
  const now = opts.now ?? (() => new Date());
  const startedAt = now();

  const site = opts.site ?? DEFAULTS.site;
  const packagesRoot = opts.packagesRoot ?? DEFAULTS.packagesRoot;
  const inboxPath = opts.inboxPath ?? DEFAULTS.inboxPath;
  const runsJsonlPath = opts.runsJsonlPath ?? DEFAULTS.runsJsonlPath;
  const statusJsonPath = opts.statusJsonPath ?? DEFAULTS.statusJsonPath;
  const attestationsJsonlPath = opts.attestationsJsonlPath ?? DEFAULTS.attestationsJsonlPath;
  const deployManifestPath = opts.deployManifestPath ?? DEFAULTS.deployManifestPath;
  const scanners = opts.scanners ?? ALL_SCANNERS;
  const runScanner = opts.runScanner ?? defaultScannerRunner;
  const emit = opts.emit ?? noopEmit;

  // 1. Load manifests + per-package expectations.
  const [manifest, allExpectations] = await Promise.all([
    loadDeployManifest(deployManifestPath),
    loadPackageExpectations(packagesRoot),
  ]);
  const joined = joinManifestAndExpectations(manifest, allExpectations);
  const targetExpectations = opts.only && opts.only.length > 0
    ? joined.filter(({ expectations }) => opts.only!.includes(expectations.packageName))
    : joined;

  // 2. Run scanners across every target package. Each package scans in
  //    parallel internally (Promise.all over scanners), but we walk
  //    packages serially to keep load bounded (124 packages × 4 tools
  //    in flight is bad for laptops).
  const cells: AttestationCell[] = [];
  const aggregateState: Record<ScannerKind, ScannerToolingState> = {
    'knip': 'absent', 'depcheck': 'absent', 'ts-prune': 'absent', 'dependency-cruiser': 'absent',
  };
  for (const { expectations } of targetExpectations) {
    const results = await Promise.all(
      scanners.map((s) =>
        runScanner(s, expectations.packageDir, {}).catch((err: unknown): ScannerResult => ({
          scanner: s,
          tooling: 'failed',
          findings: [],
          durationMs: 0,
          errorMessage: err instanceof Error ? err.message : String(err),
        })),
      ),
    );
    for (const r of results) {
      // Aggregate: once we've seen 'present' anywhere, the run is no
      // longer fully no-tooling — operator may have only some tools.
      if (r.tooling === 'present') aggregateState[r.scanner] = 'present';
      else if (r.tooling === 'failed' && aggregateState[r.scanner] !== 'present') aggregateState[r.scanner] = 'failed';
    }
    const cell = crossCheckPackage({
      packageName: expectations.packageName,
      expectations,
      scannerResults: results,
    }, { manifest });
    cells.push(cell);
  }
  const matrix = buildAttestationMatrix(cells);
  const finishedAt = now();

  // 3. Build RunRow + StatusSnapshot.
  const runRow = buildRunRow({
    startedAt, finishedAt,
    site, packagesRoot,
    scannerStates: aggregateState,
    matrix,
  });
  const snapshot = buildStatusSnapshot(runRow, matrix);

  // 4. Persist + report.
  let inboxAppended = false;
  let eventsEmitted = 0;
  let newGreenIds: ReadonlyArray<string> = [];
  if (!opts.dryRun) {
    await appendRun(runsJsonlPath, runRow);
    await writeStatusSnapshot(statusJsonPath, snapshot);
    const alreadyAttested = await loadAttestedGreenSet(attestationsJsonlPath);
    const greens = computeNewGreenIds(runRow, matrix, alreadyAttested);
    await appendGreenIds(attestationsJsonlPath, greens);
    newGreenIds = greens.map((g) => g.packageName);
    const inbox = await reportToInbox(inboxPath, runRow, matrix);
    inboxAppended = inbox.appended;
    const bus = reportToEventBus(emit, runRow, matrix);
    eventsEmitted = bus.eventsEmitted;
  }

  if (!opts.quiet) {
    const counts = countByStatus(matrix);
    console.log(
      `[usage-steward] run=${runRow.runId} site=${site} ` +
        `green=${counts.green} yellow=${counts.yellow} red=${counts.red} ` +
        `no-tooling=${counts['no-tooling']} unknown=${counts.unknown} ` +
        `(new-greens=${newGreenIds.length}, inbox-appended=${inboxAppended})`,
    );
  }

  return {
    run: runRow,
    matrix,
    inboxAppended,
    eventsEmitted,
    newGreenIds,
  };
}

function noopEmit(_event: UsageEvent): void {
  /* no-op */
}

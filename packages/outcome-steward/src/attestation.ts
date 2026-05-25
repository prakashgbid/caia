/**
 * Attestation persistence: atomic JSONL append + atomic status snapshot
 * + green-attestation roll-up (input to the SPS 5th-AND completion gate).
 *
 * The JSONL audit log (`~/.caia/outcome-steward/runs.jsonl`) is the
 * append-only history. The status snapshot (`status.json`) is the
 * latest run, atomically replaced via rename. The classifier is a pure
 * function the reporter also uses.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Attestation,
  AttestationCell,
  AttestationMatrix,
  AttestationStatus,
  BackendState,
  GreenAttestation,
  RunRow,
  StatusSnapshot,
  ThresholdDirection,
  TrendResult,
} from './types.js';

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Re-export the cell's classification. Pure — the matrix builder has
 * already applied the backend-state overrides.
 */
export function classify(cell: AttestationCell): AttestationStatus {
  return cell.status;
}

// ─── Atomic file writers ────────────────────────────────────────────────────

/**
 * Append one run row to a JSONL file. Creates parent dirs if needed.
 */
export async function appendRun(jsonlPath: string, run: RunRow): Promise<void> {
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  const line = JSON.stringify(run) + '\n';
  await fs.appendFile(jsonlPath, line, 'utf8');
}

/**
 * Atomically write the status snapshot via tmp+rename.
 */
export async function writeStatusSnapshot(statusPath: string, snapshot: StatusSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  const tmpPath = `${statusPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, statusPath);
}

/**
 * Append green-attestation rows to a JSONL file. This file is the
 * input to the SPS 5th-AND completion gate — a Solution can only
 * transition to `done` if every required SLI has a recent green row
 * here.
 */
export async function appendGreenAttestations(
  jsonlPath: string,
  attestations: ReadonlyArray<GreenAttestation>,
): Promise<void> {
  if (attestations.length === 0) return;
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  const lines = attestations.map((a) => JSON.stringify(a)).join('\n') + '\n';
  await fs.appendFile(jsonlPath, lines, 'utf8');
}

/**
 * Load the most recent N runs from a JSONL file.
 */
export async function loadRecentRuns(jsonlPath: string, n: number): Promise<ReadonlyArray<RunRow>> {
  let text: string;
  try {
    text = await fs.readFile(jsonlPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  const tail = lines.slice(Math.max(0, lines.length - n));
  const out: RunRow[] = [];
  for (const line of tail) {
    try {
      out.push(JSON.parse(line) as RunRow);
    } catch {
      // Skip malformed rows.
    }
  }
  return out;
}

/**
 * Load all green attestations from the JSONL.
 */
export async function loadGreenAttestations(jsonlPath: string): Promise<ReadonlyArray<GreenAttestation>> {
  let text: string;
  try {
    text = await fs.readFile(jsonlPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  const out: GreenAttestation[] = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      out.push(JSON.parse(line) as GreenAttestation);
    } catch {
      // Skip malformed.
    }
  }
  return out;
}

/**
 * Read the status snapshot. Returns null if missing.
 */
export async function readStatusSnapshot(statusPath: string): Promise<StatusSnapshot | null> {
  try {
    const text = await fs.readFile(statusPath, 'utf8');
    return JSON.parse(text) as StatusSnapshot;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

// ─── RunRow + StatusSnapshot constructors ──────────────────────────────────

export interface BuildRunRowOptions {
  readonly runId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly site: string;
  readonly backend: BackendState;
  readonly windowHours: number;
  readonly matrix: AttestationMatrix;
}

export function buildRunRow(opts: BuildRunRowOptions): RunRow {
  const runId = opts.runId ?? makeRunId(opts.startedAt);
  const attestations: Attestation[] = [...opts.matrix.cells.values()].map((cell) => ({
    packageName: cell.packageName,
    solutionId: cell.solutionId,
    sliMetric: cell.sliMetric,
    status: cell.status,
    latestValue: cell.latestValue,
    threshold: cell.threshold,
    direction: cell.direction,
    trend: cell.trend,
    trendSlopePerHour: cell.trendSlopePerHour,
    windowHours: opts.windowHours,
    observedAt: opts.startedAt.toISOString(),
    ...(cell.note !== undefined ? { note: cell.note } : {}),
  }));
  return {
    runId,
    startedAt: opts.startedAt.toISOString(),
    finishedAt: opts.finishedAt.toISOString(),
    site: opts.site,
    backend: opts.backend,
    windowHours: opts.windowHours,
    attestations,
    summary: summarise(attestations),
  };
}

export function buildStatusSnapshot(run: RunRow, matrix: AttestationMatrix): StatusSnapshot {
  return {
    latestRunId: run.runId,
    latestRunAt: run.finishedAt,
    backend: run.backend,
    summary: run.summary,
    cells: [...matrix.cells.values()].sort((a, b) =>
      a.packageName === b.packageName
        ? a.solutionId === b.solutionId
          ? a.sliMetric.localeCompare(b.sliMetric)
          : a.solutionId.localeCompare(b.solutionId)
        : a.packageName.localeCompare(b.packageName),
    ),
  };
}

/**
 * Build the green-attestation rows for this run. Only cells with
 * `status === 'green'` are eligible; this is the input to the SPS
 * 5th-AND completion gate.
 */
export function buildGreenAttestations(run: RunRow, matrix: AttestationMatrix): ReadonlyArray<GreenAttestation> {
  const out: GreenAttestation[] = [];
  for (const cell of matrix.cells.values()) {
    if (cell.status !== 'green') continue;
    if (cell.latestValue === null) continue;
    out.push({
      attestationId: `att_${run.runId}_${cell.packageName}_${cell.solutionId}_${cell.sliMetric}`.replace(
        /[^A-Za-z0-9_:\-./@]/g,
        '_',
      ),
      runId: run.runId,
      packageName: cell.packageName,
      solutionId: cell.solutionId,
      sliMetric: cell.sliMetric,
      value: cell.latestValue,
      threshold: cell.threshold,
      direction: cell.direction,
      windowHours: run.windowHours,
      observedAt: run.finishedAt,
      site: run.site,
    });
  }
  return out;
}

// ─── Postgres flattening ────────────────────────────────────────────────────

/**
 * Flatten the matrix into Postgres-insertable rows. Mirrors the schema
 * in `migrations/001_outcome_attestations.sql`.
 */
export interface OutcomeAttestationRow {
  readonly runId: string;
  readonly packageName: string;
  readonly solutionId: string;
  readonly sliMetric: string;
  readonly status: AttestationStatus;
  readonly latestValue: number | null;
  readonly threshold: number;
  readonly direction: ThresholdDirection;
  readonly trend: TrendResult;
  readonly trendSlopePerHr: number | null;
  readonly windowHours: number;
  readonly observedAt: string;
  readonly site: string;
  readonly backend: BackendState;
}

export function flattenForPostgres(run: RunRow, matrix: AttestationMatrix): ReadonlyArray<OutcomeAttestationRow> {
  const out: OutcomeAttestationRow[] = [];
  for (const cell of matrix.cells.values()) {
    out.push({
      runId: run.runId,
      packageName: cell.packageName,
      solutionId: cell.solutionId,
      sliMetric: cell.sliMetric,
      status: cell.status,
      latestValue: cell.latestValue,
      threshold: cell.threshold,
      direction: cell.direction,
      trend: cell.trend,
      trendSlopePerHr: cell.trendSlopePerHour,
      windowHours: run.windowHours,
      observedAt: run.finishedAt,
      site: run.site,
      backend: run.backend,
    });
  }
  return out;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function summarise(attestations: ReadonlyArray<Attestation>): RunRow['summary'] {
  const summary = {
    green: 0,
    yellow: 0,
    red: 0,
    noMetricDeclared: 0,
    noMetricStore: 0,
    unknown: 0,
  };
  for (const a of attestations) {
    switch (a.status) {
      case 'green':
        summary.green += 1;
        break;
      case 'yellow':
        summary.yellow += 1;
        break;
      case 'red':
        summary.red += 1;
        break;
      case 'no-metric-declared':
        summary.noMetricDeclared += 1;
        break;
      case 'no-metric-store':
        summary.noMetricStore += 1;
        break;
      case 'unknown':
        summary.unknown += 1;
        break;
    }
  }
  return summary;
}

function makeRunId(startedAt: Date): string {
  const ts = startedAt.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `outrun_${ts}_${randomUUID().slice(0, 8)}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

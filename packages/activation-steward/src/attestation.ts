/**
 * Attestation persistence: atomic JSONL append + atomic status snapshot.
 *
 * The JSONL audit log (`~/.caia/activation-steward/runs.jsonl`) is the
 * append-only history. The status snapshot (`status.json`) is the
 * latest run, atomically replaced via rename. The classifier is a pure
 * function the reporter also uses.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AttestationCell,
  AttestationMatrix,
  AttestationStatus,
  CrossCheckResult,
  RunRow,
  StatusSnapshot,
  TelemetryState,
} from './types.js';

// ─── Classifier ─────────────────────────────────────────────────────────────

/**
 * Classify a single (package, tenant) cell. Pure — does not look at
 * telemetry state (the caller has already applied the no-telemetry /
 * degraded overrides via {@link classifyCell} in per-tenant-isolation).
 *
 * Kept here for ergonomic re-use (the reporter calls it on each cell
 * to format INBOX messages).
 */
export function classify(cell: AttestationCell): AttestationStatus {
  return cell.status;
}

// ─── Atomic file writers ────────────────────────────────────────────────────

/**
 * Append one run row to a JSONL file. Creates parent dirs if needed.
 * Uses `fs.appendFile` which is atomic at the OS level for small writes
 * (well under PIPE_BUF on macOS / Linux).
 */
export async function appendRun(jsonlPath: string, run: RunRow): Promise<void> {
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  const line = JSON.stringify(run) + '\n';
  await fs.appendFile(jsonlPath, line, 'utf8');
}

/**
 * Atomically write the status snapshot. Writes to a tmp sibling then
 * renames, so concurrent readers never observe a partial file.
 */
export async function writeStatusSnapshot(statusPath: string, snapshot: StatusSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  const tmpPath = `${statusPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmpPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, statusPath);
}

/**
 * Load the most recent N runs from a JSONL file. Used by the reporter
 * to compute "3 consecutive degraded runs" health escalation.
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
      // Skip malformed rows rather than crash — the JSONL is operator
      // visible and may have been touched manually.
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
  readonly telemetry: TelemetryState;
  readonly windowHours: number;
  readonly matrix: AttestationMatrix;
}

export function buildRunRow(opts: BuildRunRowOptions): RunRow {
  const runId = opts.runId ?? makeRunId(opts.startedAt);
  const attestations = [...opts.matrix.cells.values()].map((cell) => ({
    packageName: cell.packageName,
    tenantId: cell.tenantId,
    status: cell.status,
    windowHours: opts.windowHours,
    observedAt: opts.startedAt.toISOString(),
    hitPathCount: cell.hitPathCount,
    expectedPathCount: cell.expectedPathCount,
    ...(cell.note !== undefined ? { note: cell.note } : {}),
  }));
  return {
    runId,
    startedAt: opts.startedAt.toISOString(),
    finishedAt: opts.finishedAt.toISOString(),
    site: opts.site,
    telemetry: opts.telemetry,
    windowHours: opts.windowHours,
    attestations,
    summary: summarise(attestations),
  };
}

export function buildStatusSnapshot(run: RunRow, matrix: AttestationMatrix): StatusSnapshot {
  return {
    latestRunId: run.runId,
    latestRunAt: run.finishedAt,
    telemetry: run.telemetry,
    summary: run.summary,
    cells: [...matrix.cells.values()].sort((a, b) =>
      a.packageName === b.packageName
        ? a.tenantId.localeCompare(b.tenantId)
        : a.packageName.localeCompare(b.packageName),
    ),
  };
}

// ─── Helpers for reporter / db migrator ─────────────────────────────────────

/**
 * Flatten the matrix into per-callpath rows suitable for Postgres
 * insertion. Mirrors the schema in
 * `migrations/001_activation_attestations.sql`.
 */
export interface CallpathAttestationRow {
  readonly runId: string;
  readonly packageName: string;
  readonly tenantId: string;
  readonly callpath: string;
  readonly serviceName: string;
  readonly spanName: string;
  readonly status: AttestationStatus;
  readonly hit: boolean;
  readonly spanCount: number;
  readonly traceCount: number;
  readonly mostRecentAt: string | null;
  readonly observedAt: string;
  readonly windowHours: number;
}

export function flattenForPostgres(run: RunRow, matrix: AttestationMatrix): ReadonlyArray<CallpathAttestationRow> {
  const out: CallpathAttestationRow[] = [];
  for (const cell of matrix.cells.values()) {
    if (cell.callpathResults.length === 0) {
      // Emit a synthetic row so the DB always has the (pkg, tenant) pair.
      out.push({
        runId: run.runId,
        packageName: cell.packageName,
        tenantId: cell.tenantId,
        callpath: '__synthetic__',
        serviceName: 'unknown',
        spanName: 'unknown',
        status: cell.status,
        hit: false,
        spanCount: 0,
        traceCount: 0,
        mostRecentAt: null,
        observedAt: run.finishedAt,
        windowHours: run.windowHours,
      });
      continue;
    }
    for (const r of cell.callpathResults) {
      out.push(buildCallpathRow(run, cell, r));
    }
  }
  return out;
}

function buildCallpathRow(
  run: RunRow,
  cell: AttestationCell,
  r: CrossCheckResult,
): CallpathAttestationRow {
  return {
    runId: run.runId,
    packageName: r.packageName,
    tenantId: r.tenantId,
    callpath: r.callpath.path,
    serviceName: r.callpath.serviceName,
    spanName: r.callpath.spanName ?? r.callpath.path,
    status: cell.status,
    hit: r.hit,
    spanCount: r.spanCount,
    traceCount: r.traceCount,
    mostRecentAt: r.mostRecentAt ? r.mostRecentAt.toISOString() : null,
    observedAt: run.finishedAt,
    windowHours: run.windowHours,
  };
}

// ─── Internals ──────────────────────────────────────────────────────────────

function summarise(attestations: RunRow['attestations']): RunRow['summary'] {
  const summary = { green: 0, yellow: 0, red: 0, noTelemetry: 0, unknown: 0 };
  for (const a of attestations) {
    if (a.status === 'green') summary.green += 1;
    else if (a.status === 'yellow') summary.yellow += 1;
    else if (a.status === 'red') summary.red += 1;
    else if (a.status === 'no-telemetry') summary.noTelemetry += 1;
    else summary.unknown += 1;
  }
  return summary;
}

function makeRunId(startedAt: Date): string {
  const ts = startedAt.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `actrun_${ts}_${randomUUID().slice(0, 8)}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

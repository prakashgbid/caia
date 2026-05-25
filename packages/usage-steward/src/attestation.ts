/**
 * Attestation persistence: atomic JSONL append + atomic status snapshot
 * + green-id attestation list (feeds SPS 5th-AND completion gate).
 *
 * The JSONL audit log (`~/.caia/usage-steward/runs.jsonl`) is the
 * append-only history. The status snapshot (`status.json`) is the
 * latest run, atomically replaced via rename. The green-id list
 * (`attestations.jsonl`) is append-only and lists every (packageName,
 * runId, observedAt) that achieved status==='green' for the first
 * time on this site.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  AttestationCell, AttestationEntry, AttestationMatrix, AttestationStatus,
  AttestationSummary, RunRow, ScannerKind, ScannerToolingState, StatusSnapshot,
} from './types.js';

// ─── File I/O ───────────────────────────────────────────────────────────────

export async function appendRun(jsonlPath: string, run: RunRow): Promise<void> {
  await fs.mkdir(path.dirname(jsonlPath), { recursive: true });
  await fs.appendFile(jsonlPath, JSON.stringify(run) + '\n', 'utf8');
}

export async function writeStatusSnapshot(statusPath: string, snapshot: StatusSnapshot): Promise<void> {
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  const tmp = `${statusPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, statusPath);
}

export async function readStatusSnapshot(statusPath: string): Promise<StatusSnapshot | null> {
  try {
    const text = await fs.readFile(statusPath, 'utf8');
    return JSON.parse(text) as StatusSnapshot;
  } catch (err) {
    if (isNotFound(err)) return null;
    throw err;
  }
}

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
    try { out.push(JSON.parse(line) as RunRow); } catch { /* skip malformed */ }
  }
  return out;
}

// ─── Green-id attestation list ──────────────────────────────────────────────

export interface GreenIdEntry {
  readonly packageName: string;
  readonly solutionId: string | null;
  readonly runId: string;
  readonly attestedAt: string;
  readonly site: string;
}

export async function appendGreenIds(
  attestationsJsonlPath: string,
  entries: ReadonlyArray<GreenIdEntry>,
): Promise<void> {
  if (entries.length === 0) return;
  await fs.mkdir(path.dirname(attestationsJsonlPath), { recursive: true });
  const lines = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  await fs.appendFile(attestationsJsonlPath, lines, 'utf8');
}

/**
 * Load the set of (packageName, site) tuples already attested green at
 * least once. Used to detect first-time-green transitions so we only
 * append new rows to attestations.jsonl.
 */
export async function loadAttestedGreenSet(
  attestationsJsonlPath: string,
): Promise<ReadonlySet<string>> {
  let text: string;
  try {
    text = await fs.readFile(attestationsJsonlPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) return new Set();
    throw err;
  }
  const out = new Set<string>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    try {
      const e = JSON.parse(line) as GreenIdEntry;
      out.add(greenKey(e.packageName, e.site));
    } catch { /* skip */ }
  }
  return out;
}

export function greenKey(packageName: string, site: string): string {
  return `${packageName}@${site}`;
}

export function computeNewGreenIds(
  run: RunRow,
  matrix: AttestationMatrix,
  alreadyAttested: ReadonlySet<string>,
): ReadonlyArray<GreenIdEntry> {
  const out: GreenIdEntry[] = [];
  for (const cell of matrix.cells.values()) {
    if (cell.status !== 'green') continue;
    if (alreadyAttested.has(greenKey(cell.packageName, run.site))) continue;
    out.push({
      packageName: cell.packageName,
      solutionId: cell.solutionId,
      runId: run.runId,
      attestedAt: run.finishedAt,
      site: run.site,
    });
  }
  return out;
}

// ─── RunRow + StatusSnapshot construction ──────────────────────────────────

export interface BuildRunRowOptions {
  readonly runId?: string;
  readonly startedAt: Date;
  readonly finishedAt: Date;
  readonly site: string;
  readonly packagesRoot: string;
  readonly scannerStates: Readonly<Record<ScannerKind, ScannerToolingState>>;
  readonly matrix: AttestationMatrix;
}

export function buildRunRow(opts: BuildRunRowOptions): RunRow {
  const runId = opts.runId ?? makeRunId(opts.startedAt);
  const attestations: AttestationEntry[] = [...opts.matrix.cells.values()].map((cell) => ({
    packageName: cell.packageName,
    solutionId: cell.solutionId,
    status: cell.status,
    observedAt: opts.startedAt.toISOString(),
    ...(cell.note !== undefined ? { note: cell.note } : {}),
  }));
  return {
    runId,
    startedAt: opts.startedAt.toISOString(),
    finishedAt: opts.finishedAt.toISOString(),
    site: opts.site,
    packagesRoot: opts.packagesRoot,
    scannerStates: opts.scannerStates,
    attestations,
    summary: summarise(attestations),
  };
}

export function buildStatusSnapshot(run: RunRow, matrix: AttestationMatrix): StatusSnapshot {
  return {
    latestRunId: run.runId,
    latestRunAt: run.finishedAt,
    site: run.site,
    summary: run.summary,
    scannerStates: run.scannerStates,
    cells: [...matrix.cells.values()].sort((a, b) => a.packageName.localeCompare(b.packageName)),
  };
}

// ─── Postgres row flattener ─────────────────────────────────────────────────

export interface PgAttestationRow {
  readonly runId: string;
  readonly packageName: string;
  readonly solutionId: string | null;
  readonly status: AttestationStatus;
  readonly site: string;
  readonly observedAt: string;
  readonly expectedImportCount: number;
  readonly satisfiedImportCount: number;
  readonly expectedExportCount: number;
  readonly reachableExportCount: number;
  readonly orphanCount: number;
  readonly unusedDepCount: number;
  readonly missingDepCount: number;
  readonly circularDepCount: number;
  readonly note: string | null;
}

export function flattenForPostgres(run: RunRow, matrix: AttestationMatrix): ReadonlyArray<PgAttestationRow> {
  const out: PgAttestationRow[] = [];
  for (const c of matrix.cells.values()) {
    out.push({
      runId: run.runId,
      packageName: c.packageName,
      solutionId: c.solutionId,
      status: c.status,
      site: run.site,
      observedAt: run.finishedAt,
      expectedImportCount: c.expectedImportCount,
      satisfiedImportCount: c.satisfiedImportCount,
      expectedExportCount: c.expectedExportCount,
      reachableExportCount: c.reachableExportCount,
      orphanCount: c.orphanCount,
      unusedDepCount: c.unusedDepCount,
      missingDepCount: c.missingDepCount,
      circularDepCount: c.circularDepCount,
      note: c.note ?? null,
    });
  }
  return out;
}

export function classify(cell: AttestationCell): AttestationStatus {
  return cell.status;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function summarise(attestations: ReadonlyArray<AttestationEntry>): AttestationSummary {
  const s: AttestationSummary = { green: 0, yellow: 0, red: 0, noTooling: 0, unknown: 0 };
  const m = s as { -readonly [K in keyof AttestationSummary]: number };
  for (const a of attestations) {
    if (a.status === 'green') m.green += 1;
    else if (a.status === 'yellow') m.yellow += 1;
    else if (a.status === 'red') m.red += 1;
    else if (a.status === 'no-tooling') m.noTooling += 1;
    else m.unknown += 1;
  }
  return s;
}

function makeRunId(startedAt: Date): string {
  const ts = startedAt.toISOString().replace(/[-:T.]/g, '').slice(0, 14);
  return `usgrun_${ts}_${randomUUID().slice(0, 8)}`;
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}

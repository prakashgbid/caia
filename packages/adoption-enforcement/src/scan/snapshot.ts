import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ExportRow, ExportsSnapshot } from './types.js';

/**
 * Read a previously written exports snapshot. Returns `null` if the file is
 * missing — caller should treat that as a first-time run (all exports are new).
 * Malformed snapshots throw, so corruption surfaces loudly instead of
 * silently re-flagging every export.
 */
export function readSnapshot(snapshotPath: string): ExportsSnapshot | null {
  if (!existsSync(snapshotPath)) return null;
  const raw = readFileSync(snapshotPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isSnapshot(parsed)) {
    throw new Error(`malformed exports snapshot at ${snapshotPath}`);
  }
  return parsed;
}

/**
 * Write a snapshot atomically (write to sibling tmp file, then rename).
 * Creates the containing directory if it does not exist.
 */
export function writeSnapshotAtomic(snapshotPath: string, snapshot: ExportsSnapshot): void {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const tmp = `${snapshotPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(tmp, snapshotPath);
}

/**
 * Compute the rows that are present in `current` but absent from `prior`.
 * Identity is the (identifier, decl_kind, isTypeOnly) triple — a row that
 * flips type-only or changes decl kind counts as new.
 */
export function diffExports(
  prior: readonly ExportRow[],
  current: readonly ExportRow[],
): ExportRow[] {
  const priorKeys = new Set(prior.map(rowKey));
  return current.filter((row) => !priorKeys.has(rowKey(row)));
}

export function rowKey(row: ExportRow): string {
  return `${row.identifier} ${row.decl_kind} ${row.isTypeOnly ? 't' : 'v'}`;
}

function isSnapshot(value: unknown): value is ExportsSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ExportsSnapshot> & { exports?: unknown };
  return (
    v.version === 1 &&
    typeof v.indexPath === 'string' &&
    typeof v.capturedAt === 'string' &&
    Array.isArray(v.exports) &&
    v.exports.every(isExportRow)
  );
}

function isExportRow(value: unknown): value is ExportRow {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ExportRow>;
  return (
    typeof v.identifier === 'string' &&
    typeof v.decl_kind === 'string' &&
    typeof v.isTypeOnly === 'boolean'
  );
}

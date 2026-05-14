// H-13 (chain-runner-battle-harden phase 9, 2026-05-14). Backup-before-mutate
// helper. Every state-changing CLI verb is wrapped in `withStateBackup` so a
// botched edit can be recovered by copying the most recent snapshot back over
// state.json.
//
// Pre-H-13 the adjudication verbs each wrote their own .backups/state.json.bak
// sidecar (see state.ts:writeStateBackup); H-13 generalizes this so EVERY
// mutation path leaves a snapshot — adjudicate / re-arm / force-fail / pause /
// resume / mark-done / mark-failed / budget. The adjudication verbs still keep
// their richer per-call backup (with suffix encoding which action ran); this
// helper is the cheap belt-and-suspenders snapshot for everything else.
//
// Layout: <chain-dir>/.backups/state.<isoNow>.json
//   - one file per mutation, isoNow with colons replaced by `-` so the path
//     is filesystem-safe on every platform we run on
//   - last 20 retained (LRU prune by mtime, oldest deleted)
//   - the prune happens AFTER the new snapshot lands, so an interrupted prune
//     never deletes the just-taken backup
//
// Why both bin/gate-mark-done.sh's pre-mark-done bash backup AND this helper?
// Different layers: gate-mark-done validates the PR/artifact contract BEFORE
// mark-done; this helper backs up state.json AT THE INSTANT OF mutation. The
// bash helper goes away in phase 11; this one is the long-lived path.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import type { ChainPaths } from './types.js';

export const BACKUP_DIR_NAME = '.backups';
export const DEFAULT_RETENTION = 20;
export const BACKUP_PREFIX = 'state.';
export const BACKUP_SUFFIX = '.json';

export interface WithStateBackupContext {
  paths: ChainPaths;
}

export interface WithStateBackupOptions {
  /** How many snapshots to keep. Default 20. Pass 0 to disable pruning. */
  retention?: number;
  /**
   * When set, the helper does not take a snapshot for a missing state.json
   * (default true). Set false to require state.json to exist.
   */
  skipIfMissing?: boolean;
}

export interface BackupResult {
  /** Absolute path of the snapshot written. Empty when no snapshot was taken. */
  path: string;
  /** Snapshots pruned by this call (oldest-first). */
  pruned: string[];
}

function backupsDir(ctx: WithStateBackupContext): string {
  return join(ctx.paths.baseDir, BACKUP_DIR_NAME);
}

function isoStamp(): string {
  return new Date().toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Take a snapshot of `state.json` into `<baseDir>/.backups/`, then prune the
 * directory to at most `retention` snapshots. Returns the snapshot path and
 * the list of pruned files. Idempotent if state.json is missing (returns
 * { path: '', pruned: [] } unless skipIfMissing=false, in which case it throws).
 */
export function takeStateBackup(
  ctx: WithStateBackupContext,
  opts: WithStateBackupOptions = {},
): BackupResult {
  const retention = opts.retention ?? DEFAULT_RETENTION;
  const skipIfMissing = opts.skipIfMissing ?? true;
  if (!existsSync(ctx.paths.stateFile)) {
    if (skipIfMissing) return { path: '', pruned: [] };
    throw new Error(`state.json not found at ${ctx.paths.stateFile}`);
  }
  const dir = backupsDir(ctx);
  mkdirSync(dir, { recursive: true });
  // Collision-proof name: stamp + hrtime (in case two mutations land inside the
  // same ms, which the regression tests can do).
  const hr = process.hrtime.bigint().toString(36);
  const filename = `${BACKUP_PREFIX}${isoStamp()}.${hr}${BACKUP_SUFFIX}`;
  const fullPath = join(dir, filename);
  copyFileSync(ctx.paths.stateFile, fullPath);
  const pruned = retention > 0 ? pruneBackups(ctx, retention) : [];
  return { path: fullPath, pruned };
}

/**
 * Wrap a mutation closure so a snapshot is taken before it runs. Returns
 * whatever the mutation returned. The backup metadata is exposed via the
 * outparam-style `onBackup` callback so call sites that want to record the
 * snapshot path in their audit event can do so without two backups landing.
 */
export function withStateBackup<T>(
  ctx: WithStateBackupContext,
  mutation: () => T,
  opts: WithStateBackupOptions & { onBackup?: (b: BackupResult) => void } = {},
): T {
  const backup = takeStateBackup(ctx, opts);
  if (opts.onBackup) opts.onBackup(backup);
  return mutation();
}

/**
 * Async flavor: the mutation may return a Promise. Backup runs synchronously
 * before the mutation starts, so even if the promise rejects the snapshot is
 * on disk.
 */
export async function withStateBackupAsync<T>(
  ctx: WithStateBackupContext,
  mutation: () => Promise<T>,
  opts: WithStateBackupOptions & { onBackup?: (b: BackupResult) => void } = {},
): Promise<T> {
  const backup = takeStateBackup(ctx, opts);
  if (opts.onBackup) opts.onBackup(backup);
  return mutation();
}

/**
 * LRU prune: keep only `retention` newest files (by mtime). Returns the
 * absolute paths of the files removed. Files that are NOT in our prefix
 * pattern are left alone (so the existing state.json.bak.<suffix>.<iso>
 * sidecars from the adjudication verbs aren't touched).
 */
export function pruneBackups(
  ctx: WithStateBackupContext,
  retention: number,
): string[] {
  const dir = backupsDir(ctx);
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir)
    .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX))
    .map((n) => {
      const full = join(dir, n);
      return { name: n, full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime); // newest first
  const removed: string[] = [];
  for (const entry of entries.slice(retention)) {
    try {
      unlinkSync(entry.full);
      removed.push(entry.full);
    } catch {
      // ignore — best-effort
    }
  }
  return removed;
}

/** For tests: list backup paths sorted newest-first. */
export function listBackups(ctx: WithStateBackupContext): string[] {
  const dir = backupsDir(ctx);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.startsWith(BACKUP_PREFIX) && n.endsWith(BACKUP_SUFFIX))
    .map((n) => {
      const full = join(dir, n);
      return { full, mtime: statSync(full).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)
    .map((e) => e.full);
}

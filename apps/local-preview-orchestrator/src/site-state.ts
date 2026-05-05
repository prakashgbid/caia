/**
 * Per-site state file.
 *
 * Each deploy writes the latest state to `installRoot/<site>/state.json` so
 * the status dashboard (PR-C) can read a single JSON document and render the
 * full picture without re-walking the filesystem.
 *
 * Path-traversal note: `sitePath` arguments come from the compile-time SITES
 * registry; no user-controllable input reaches this module.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface SiteState {
  name: string;
  url: string;
  current_sha: string | null;
  previous_sha: string | null;
  last_deploy_at: string | null;
  last_deploy_status:
    | 'success'
    | 'noop'
    | 'build-failed'
    | 'health-check-failed'
    | 'rollback-failed'
    | 'disk-full'
    | 'aborted'
    | null;
  last_deploy_error: string | null;
  last_deploy_duration_ms: number | null;
  last_health_check_at: string | null;
  last_health_check_status: 'ok' | 'failed' | null;
  process_state: 'unknown' | 'running' | 'stopped';
  updated_at: string;
}

export function defaultSiteState(name: string, port: number): SiteState {
  return {
    name,
    url: `http://localhost:${port}`,
    current_sha: null,
    previous_sha: null,
    last_deploy_at: null,
    last_deploy_status: null,
    last_deploy_error: null,
    last_deploy_duration_ms: null,
    last_health_check_at: null,
    last_health_check_status: null,
    process_state: 'unknown',
    updated_at: new Date().toISOString()
  };
}

/**
 * Read the state file for a site.
 * Returns the default state if the file does not exist or is malformed.
 */
export function readSiteState(
  sitePath: string,
  fallback: { name: string; port: number }
): SiteState {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
  const filePath = join(sitePath, 'state.json');
  if (!existsSync(filePath)) {
    return defaultSiteState(fallback.name, fallback.port);
  }
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as SiteState;
    return parsed;
  } catch {
    return defaultSiteState(fallback.name, fallback.port);
  }
}

/**
 * Atomically write the state file for a site.
 * Writes to a temp file then renames so a concurrent reader never sees a torn write.
 */
export function writeSiteState(sitePath: string, state: SiteState): void {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
  const filePath = join(sitePath, 'state.json');
  const tmpPath = `${filePath}.tmp`;
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const next: SiteState = { ...state, updated_at: new Date().toISOString() };
  writeFileSync(tmpPath, JSON.stringify(next, null, 2), 'utf-8');
  // rename is atomic on POSIX
  renameSync(tmpPath, filePath);
}

/**
 * Apply a partial update on top of the existing state and persist it.
 */
export function updateSiteState(
  sitePath: string,
  fallback: { name: string; port: number },
  patch: Partial<SiteState>
): SiteState {
  const current = readSiteState(sitePath, fallback);
  const next: SiteState = { ...current, ...patch };
  writeSiteState(sitePath, next);
  return next;
}

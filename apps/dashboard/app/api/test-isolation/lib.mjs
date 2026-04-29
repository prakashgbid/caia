/**
 * apps/dashboard/app/api/test-isolation/lib.mjs
 *
 * Pure helpers used by route.ts. Plain ESM (.mjs) so they can be
 * tested with `node:assert` without spinning up a TS compiler — the
 * dashboard has no vitest harness wired today.
 *
 * @typedef {Object} BrowserlessPressure
 * @property {boolean} isAvailable
 * @property {number} running
 * @property {number} queued
 * @property {number} maxConcurrent
 * @property {number} maxQueued
 * @property {number} cpu
 * @property {number} memory
 * @property {string} reason
 *
 * @typedef {Object} SqliteFiles
 * @property {number} total
 * @property {number} stale
 * @property {number} bytes
 * @property {Array<{name: string, bytes: number, mtimeMs: number}>} recent
 *
 * @typedef {Object} ShardSummary
 * @property {number} schemaVersion
 * @property {string} generatedAt
 * @property {string|null} runId
 * @property {Object} totals
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export const SQLITE_PREFIX = 'caia-test-';
export const STALE_AGE_MS = 60 * 60 * 1000;

/**
 * Synchronously scan `dir` for SQLite test files and summarise them.
 * Resilient: missing dir → empty result. Caller may pass `now` to
 * simulate the time reference (used by tests).
 *
 * @param {string} dir
 * @param {number} [now]
 * @returns {SqliteFiles}
 */
export function scanSqliteFiles(dir, now = Date.now()) {
  const empty = { total: 0, stale: 0, bytes: 0, recent: [] };
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return empty;
  }
  const matches = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.startsWith(SQLITE_PREFIX)) continue;
    if (entry.name.endsWith('-wal') || entry.name.endsWith('-shm')) continue;
    let stat;
    try {
      stat = fs.statSync(path.join(dir, entry.name));
    } catch {
      continue;
    }
    matches.push({
      name: entry.name,
      bytes: stat.size,
      mtimeMs: stat.mtimeMs,
      stale: now - stat.mtimeMs >= STALE_AGE_MS,
    });
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return {
    total: matches.length,
    stale: matches.filter((m) => m.stale).length,
    bytes: matches.reduce((sum, m) => sum + m.bytes, 0),
    recent: matches.slice(0, 10).map((m) => ({
      name: m.name,
      bytes: m.bytes,
      mtimeMs: m.mtimeMs,
    })),
  };
}

/**
 * Read the FIX-012 shard summary from disk.
 *
 * @param {string|null|undefined} summaryPath
 * @returns {ShardSummary|null}
 */
export function readShardSummary(summaryPath) {
  if (!summaryPath) return null;
  try {
    const raw = fs.readFileSync(summaryPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} httpEndpoint
 * @param {string} token
 * @returns {string}
 */
export function buildPressureUrl(httpEndpoint, token) {
  return `${httpEndpoint.replace(/\/+$/, '')}/pressure?token=${encodeURIComponent(token)}`;
}

/**
 * Validate the structure of a Browserless /pressure response. Accepts
 * the v2 wrapped shape (`{ pressure: { ... } }`) or a bare object
 * (forward-compat).
 *
 * @param {unknown} body
 * @returns {BrowserlessPressure|null}
 */
export function extractPressure(body) {
  if (!body || typeof body !== 'object') return null;
  const candidate = 'pressure' in body ? body.pressure : body;
  if (!candidate || typeof candidate !== 'object') return null;
  const isAvailable = candidate.isAvailable;
  const running = candidate.running;
  const queued = candidate.queued ?? candidate.queue;
  const maxConcurrent = candidate.maxConcurrent;
  const maxQueued = candidate.maxQueued;
  const cpu = candidate.cpu;
  const memory = candidate.memory;
  const reason = candidate.reason;
  if (
    typeof isAvailable !== 'boolean'
    || typeof running !== 'number'
    || typeof maxConcurrent !== 'number'
  ) {
    return null;
  }
  return {
    isAvailable,
    running,
    queued: typeof queued === 'number' ? queued : 0,
    maxConcurrent,
    maxQueued: typeof maxQueued === 'number' ? maxQueued : 0,
    cpu: typeof cpu === 'number' ? cpu : 0,
    memory: typeof memory === 'number' ? memory : 0,
    reason: typeof reason === 'string' ? reason : '',
  };
}

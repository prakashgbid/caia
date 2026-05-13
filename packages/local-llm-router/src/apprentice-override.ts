/**
 * Apprentice adapter routing override.
 *
 * Phase 3 of the Apprentice loop publishes a JSON canary-routing config
 * via @chiefaia/apprentice-serving. The file lives at
 *   ~/Documents/projects/apprentice/canary-routing.json
 * and follows the shape:
 *   {
 *     "version": 1,
 *     "production": { "ollamaModelName": "apprentice-v0001", ... } | null,
 *     "canary":     { "ollamaModelName": "apprentice-v0002", "percent": N, ... } | null
 *   }
 *
 * Until Phase 3 trains + registers a first adapter, this file does not
 * exist — `resolveApprenticeOverride` returns null and the router keeps
 * its baseline `localModel`. Once an adapter is promoted, the router
 * starts directing matching tasks to the apprentice tag (canary % hashed
 * deterministically per requestId).
 *
 * No CanaryRouter import — we read the file directly to avoid pulling
 * the serving package into the router's runtime path. The file format
 * is stable per Phase 3's DESIGN.md.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const DEFAULT_CANARY_ROUTING_PATH = join(
  process.env['APPRENTICE_CANARY_ROUTING_PATH'] ??
    join(homedir(), 'Documents/projects/apprentice/canary-routing.json')
);

const APPRENTICE_ELIGIBLE_TASK_PREFIXES: readonly string[] = Object.freeze([
  'domain-classification',
  'nature-classification',
  'dedup-check',
  'feedback-',
  'directive-',
  'validation-',
  'apprentice-'
]);

interface CanaryEntry {
  readonly ollamaModelName: string;
  readonly percent?: number;
}

interface CanaryRoutingFile {
  readonly version: number;
  readonly production: CanaryEntry | null;
  readonly canary: (CanaryEntry & { readonly percent: number }) | null;
}

interface CacheEntry {
  readonly mtimeMs: number;
  readonly file: CanaryRoutingFile | null;
}

let cache: { path: string; entry: CacheEntry } | null = null;

function readConfigFile(path: string): CanaryRoutingFile | null {
  if (!existsSync(path)) return null;
  try {
    const st = statSync(path);
    if (cache && cache.path === path && cache.entry.mtimeMs === st.mtimeMs) {
      return cache.entry.file;
    }
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as CanaryRoutingFile;
    if (!parsed || parsed.version !== 1) {
      cache = { path, entry: { mtimeMs: st.mtimeMs, file: null } };
      return null;
    }
    cache = { path, entry: { mtimeMs: st.mtimeMs, file: parsed } };
    return parsed;
  } catch {
    return null;
  }
}

function isEligible(taskType: string): boolean {
  for (const prefix of APPRENTICE_ELIGIBLE_TASK_PREFIXES) {
    if (taskType === prefix || taskType.startsWith(prefix)) return true;
  }
  return false;
}

function bucketOf(requestId: string): number {
  const hex = createHash('sha256').update(requestId).digest('hex');
  return parseInt(hex.slice(0, 8), 16) % 100;
}

export interface ApprenticeOverrideContext {
  /** Routed task type (matched against eligible prefixes). */
  readonly taskType: string;
  /**
   * Per-request id used for deterministic canary hashing. Falls back to
   * a fresh random id when callers don't have one — that's acceptable
   * because the canary share % still holds in aggregate.
   */
  readonly requestId?: string;
  /** Override the default config path for tests. */
  readonly canaryRoutingPath?: string;
}

export interface ApprenticeOverrideResult {
  /** Apprentice ollama tag to dispatch to, e.g. "apprentice-v0042". */
  readonly model: string;
  /** Which slot was picked, for telemetry. */
  readonly slot: 'production' | 'canary';
}

/**
 * Returns the apprentice ollama tag to use for this task, or null when
 * no apprentice adapter is in production (the router should then use
 * the rule's baseline `localModel`).
 *
 * Pure read; safe to call on the hot path. The config file is mtime-cached.
 */
export function resolveApprenticeOverride(
  ctx: ApprenticeOverrideContext
): ApprenticeOverrideResult | null {
  if (!isEligible(ctx.taskType)) return null;
  const path = ctx.canaryRoutingPath ?? DEFAULT_CANARY_ROUTING_PATH;
  const f = readConfigFile(path);
  if (f === null || f.production === null) return null;
  const requestId = ctx.requestId ?? Math.random().toString(36).slice(2);
  if (f.canary !== null) {
    const bucket = bucketOf(requestId);
    if (bucket < f.canary.percent) {
      return { model: f.canary.ollamaModelName, slot: 'canary' };
    }
  }
  return { model: f.production.ollamaModelName, slot: 'production' };
}

/** Test seam — clears the mtime cache so tests can rewrite the file. */
export function __resetApprenticeOverrideCache(): void {
  cache = null;
}

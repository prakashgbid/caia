import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { ExternalAgentEntry } from './external-agents-schema.js';
import type { ExternalAgentsSnapshot } from './types.js';

/**
 * Read a previously written external-agents snapshot. Returns `null` if the
 * file is missing — caller treats that as a first-time run (every entry is
 * new). Malformed snapshots throw so corruption surfaces loudly instead of
 * silently re-flagging every entry.
 */
export function readExternalAgentsSnapshot(snapshotPath: string): ExternalAgentsSnapshot | null {
  if (!existsSync(snapshotPath)) return null;
  const raw = readFileSync(snapshotPath, 'utf8');
  const parsed = JSON.parse(raw) as unknown;
  if (!isSnapshot(parsed)) {
    throw new Error(`malformed external-agents snapshot at ${snapshotPath}`);
  }
  return parsed;
}

/**
 * Write a snapshot atomically (sibling tmp then rename). Creates the
 * containing directory if it does not exist.
 */
export function writeExternalAgentsSnapshotAtomic(
  snapshotPath: string,
  snapshot: ExternalAgentsSnapshot,
): void {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  const tmp = `${snapshotPath}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  renameSync(tmp, snapshotPath);
}

/**
 * Compute entries present in `current` but absent from `prior`. Identity is
 * the `name` field — adding/removing capabilities or call-site patterns to an
 * existing entry does NOT make it new (the substrate re-scans those each run
 * during cross-ref).
 */
export function diffExternalAgentEntries(
  prior: readonly ExternalAgentEntry[],
  current: readonly ExternalAgentEntry[],
): ExternalAgentEntry[] {
  const priorNames = new Set(prior.map((e) => e.name));
  return current.filter((entry) => !priorNames.has(entry.name));
}

function isSnapshot(value: unknown): value is ExternalAgentsSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ExternalAgentsSnapshot>;
  return (
    v.version === 1 &&
    typeof v.configPath === 'string' &&
    typeof v.capturedAt === 'string' &&
    Array.isArray(v.mcp_servers) &&
    Array.isArray(v.agent_manifests) &&
    v.mcp_servers.every(isEntry) &&
    v.agent_manifests.every(isEntry)
  );
}

function isEntry(value: unknown): value is ExternalAgentEntry {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Partial<ExternalAgentEntry>;
  return (
    typeof v.name === 'string' &&
    typeof v.repo === 'string' &&
    Array.isArray(v.capabilities) &&
    v.capabilities.every((c) => typeof c === 'string') &&
    Array.isArray(v.suggested_call_sites) &&
    v.suggested_call_sites.every((c) => typeof c === 'string')
  );
}

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

import {
  diffExternalAgentEntries,
  readExternalAgentsSnapshot,
  writeExternalAgentsSnapshotAtomic,
} from './external-agents-snapshot.js';
import {
  externalAgentsFileSchema,
  type ExternalAgentEntry,
  type ExternalAgentKind,
  type ExternalAgentsFile,
} from './external-agents-schema.js';
import type {
  DetectNewExternalAgentsOptions,
  DetectNewExternalAgentsResult,
  ExternalAgentsSnapshot,
  NewExternalAgentRow,
} from './types.js';

const DEFAULT_CONFIG_REL = '.adoption/external-agents.yaml';
const DEFAULT_SNAPSHOT_REL = '.adoption/external-agents-snapshot.json';

/**
 * Detect newly added external-agent integrations declared in
 * `<repoRoot>/.adoption/external-agents.yaml`.
 *
 * Behaviour:
 *   - Config file missing → no-op (zero rows, `configMissing: true`). Design
 *     §12 explicitly gates the detector on this file existing.
 *   - First run (no snapshot) → every entry is treated as new.
 *   - Subsequent runs → diff by entry `name` within each section; persist a
 *     fresh snapshot atomically.
 *   - Malformed YAML or schema-invalid content throws — the substrate refuses
 *     to silently mis-classify rather than emit garbage downstream.
 */
export function detectNewExternalAgents(
  repoRoot: string,
  options: DetectNewExternalAgentsOptions = {},
): DetectNewExternalAgentsResult {
  if (!isAbsolute(repoRoot)) {
    throw new Error(`detectNewExternalAgents: repoRoot must be absolute, got ${repoRoot}`);
  }

  const configPath = options.configPath ?? resolve(repoRoot, DEFAULT_CONFIG_REL);
  const snapshotPath = options.snapshotPath ?? resolve(repoRoot, DEFAULT_SNAPSHOT_REL);

  if (!existsSync(configPath)) {
    return {
      rows: [],
      configPath,
      snapshotPath,
      configMissing: true,
      firstRun: false,
    };
  }

  const parsed = loadConfig(configPath);
  const prior = readExternalAgentsSnapshot(snapshotPath);
  const firstRun = prior === null;

  const newMcp = firstRun
    ? parsed.mcp_servers.slice()
    : diffExternalAgentEntries(prior.mcp_servers, parsed.mcp_servers);
  const newManifests = firstRun
    ? parsed.agent_manifests.slice()
    : diffExternalAgentEntries(prior.agent_manifests, parsed.agent_manifests);

  const rows: NewExternalAgentRow[] = [
    ...newMcp.map((e) => toRow('mcp_server', e)),
    ...newManifests.map((e) => toRow('agent_manifest', e)),
  ];

  const writeSnapshot = options.writeSnapshot ?? true;
  if (writeSnapshot) {
    const snapshot: ExternalAgentsSnapshot = {
      version: 1,
      configPath,
      capturedAt: new Date().toISOString(),
      mcp_servers: parsed.mcp_servers,
      agent_manifests: parsed.agent_manifests,
    };
    writeExternalAgentsSnapshotAtomic(snapshotPath, snapshot);
  }

  return { rows, configPath, snapshotPath, configMissing: false, firstRun };
}

export function defaultExternalAgentsConfigPath(repoRoot: string): string {
  return resolve(repoRoot, DEFAULT_CONFIG_REL);
}

export function defaultExternalAgentsSnapshotPath(repoRoot: string): string {
  return resolve(repoRoot, DEFAULT_SNAPSHOT_REL);
}

function loadConfig(configPath: string): ExternalAgentsFile {
  const raw = readFileSync(configPath, 'utf8');
  let doc: unknown;
  try {
    doc = parseYaml(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse YAML at ${configPath}: ${reason}`, { cause: err });
  }
  if (doc === null || doc === undefined) {
    // Empty file or all-comments file — treat as a valid v1 doc with no entries.
    return externalAgentsFileSchema.parse({ version: 1 });
  }
  const result = externalAgentsFileSchema.safeParse(doc);
  if (!result.success) {
    throw new Error(
      `invalid external-agents.yaml at ${configPath}: ${result.error.issues
        .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return result.data;
}

function toRow(kind: ExternalAgentKind, entry: ExternalAgentEntry): NewExternalAgentRow {
  return {
    kind: 'new_external_agent',
    agent_kind: kind,
    name: entry.name,
    repo: entry.repo,
    capabilities: entry.capabilities,
    suggested_call_sites: entry.suggested_call_sites,
  };
}

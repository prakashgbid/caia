import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  defaultExternalAgentsConfigPath,
  defaultExternalAgentsSnapshotPath,
  detectNewExternalAgents,
} from '../../src/scan/detect-new-external-agents.js';
import {
  diffExternalAgentEntries,
  readExternalAgentsSnapshot,
} from '../../src/scan/external-agents-snapshot.js';
import type {
  ExternalAgentsSnapshot,
  NewExternalAgentRow,
} from '../../src/scan/types.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(HERE, 'fixtures', 'external-agents');

function fixturePath(name: string): string {
  return join(FIXTURES, name);
}

interface SandboxRepo {
  readonly repoRoot: string;
  readonly configPath: string;
  readonly snapshotPath: string;
}

function makeSandboxRepo(fixtureName?: string): SandboxRepo {
  const repoRoot = mkdtempSync(join(tmpdir(), 'ext-agents-detect-'));
  const configPath = defaultExternalAgentsConfigPath(repoRoot);
  const snapshotPath = defaultExternalAgentsSnapshotPath(repoRoot);
  if (fixtureName !== undefined) {
    mkdirSync(dirname(configPath), { recursive: true });
    copyFileSync(fixturePath(fixtureName), configPath);
  }
  return { repoRoot, configPath, snapshotPath };
}

const sandboxes: string[] = [];

beforeEach(() => {
  sandboxes.length = 0;
});

afterEach(() => {
  for (const root of sandboxes) {
    rmSync(root, { recursive: true, force: true });
  }
});

function track(repo: SandboxRepo): SandboxRepo {
  sandboxes.push(repo.repoRoot);
  return repo;
}

function rowNames(rows: readonly NewExternalAgentRow[]): string[] {
  return rows.map((r) => `${r.agent_kind}:${r.name}`);
}

describe('scan/detect-new-external-agents', () => {
  it('is a no-op when external-agents.yaml is missing (priority #4 not landed)', () => {
    const repo = track(makeSandboxRepo());
    const result = detectNewExternalAgents(repo.repoRoot);
    expect(result.configMissing).toBe(true);
    expect(result.rows).toEqual([]);
    expect(result.firstRun).toBe(false);
    expect(existsSync(repo.snapshotPath)).toBe(false);
  });

  it('treats every entry as new on first run (no prior snapshot) and persists one', () => {
    const repo = track(makeSandboxRepo('valid.yaml'));
    const result = detectNewExternalAgents(repo.repoRoot);

    expect(result.configMissing).toBe(false);
    expect(result.firstRun).toBe(true);
    expect(rowNames(result.rows)).toEqual([
      'mcp_server:filesystem-mcp',
      'mcp_server:sqlite-mcp',
      'agent_manifest:ext-coder',
    ]);
    expect(result.rows.every((r) => r.kind === 'new_external_agent')).toBe(true);

    const fs = result.rows.find((r) => r.name === 'filesystem-mcp');
    expect(fs?.capabilities).toEqual(['read_file', 'write_file', 'list_dir']);
    expect(fs?.suggested_call_sites).toEqual([
      '\\bfs\\.readFile(Sync)?\\b',
      '\\bfs\\.writeFile(Sync)?\\b',
    ]);
    expect(fs?.repo).toBe(
      'github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    );

    const snapshot = readExternalAgentsSnapshot(repo.snapshotPath);
    expect(snapshot?.version).toBe(1);
    expect(snapshot?.mcp_servers.map((e) => e.name)).toEqual([
      'filesystem-mcp',
      'sqlite-mcp',
    ]);
    expect(snapshot?.agent_manifests.map((e) => e.name)).toEqual(['ext-coder']);
  });

  it('treats an empty (comments-only) file as a valid v1 doc with no entries', () => {
    const repo = track(makeSandboxRepo('empty.yaml'));
    const result = detectNewExternalAgents(repo.repoRoot);

    expect(result.configMissing).toBe(false);
    expect(result.firstRun).toBe(true);
    expect(result.rows).toEqual([]);
    expect(existsSync(repo.snapshotPath)).toBe(true);

    const snapshot = readExternalAgentsSnapshot(repo.snapshotPath);
    expect(snapshot?.mcp_servers).toEqual([]);
    expect(snapshot?.agent_manifests).toEqual([]);
  });

  it('emits only the freshly added entries on a follow-up run', () => {
    const repo = track(makeSandboxRepo('valid.yaml'));
    detectNewExternalAgents(repo.repoRoot);

    // Swap in the larger fixture in place of the original config.
    copyFileSync(fixturePath('added-second.yaml'), repo.configPath);
    const second = detectNewExternalAgents(repo.repoRoot);

    expect(second.firstRun).toBe(false);
    expect(rowNames(second.rows)).toEqual([
      'mcp_server:postgres-mcp',
      'agent_manifest:ext-reviewer',
    ]);
  });

  it('emits zero rows when the config is unchanged between runs', () => {
    const repo = track(makeSandboxRepo('valid.yaml'));
    detectNewExternalAgents(repo.repoRoot);
    const second = detectNewExternalAgents(repo.repoRoot);

    expect(second.firstRun).toBe(false);
    expect(second.rows).toEqual([]);
  });

  it('does NOT write a snapshot when writeSnapshot is false', () => {
    const repo = track(makeSandboxRepo('valid.yaml'));
    const result = detectNewExternalAgents(repo.repoRoot, { writeSnapshot: false });
    expect(result.rows).toHaveLength(3);
    expect(existsSync(repo.snapshotPath)).toBe(false);
  });

  it('throws on malformed YAML, leaving snapshot untouched', () => {
    const repo = track(makeSandboxRepo('malformed-yaml.yaml'));
    expect(() => detectNewExternalAgents(repo.repoRoot)).toThrowError(
      /failed to parse YAML/i,
    );
    expect(existsSync(repo.snapshotPath)).toBe(false);
  });

  it('throws on schema-invalid YAML (missing name / wrong version), leaving snapshot untouched', () => {
    const repo = track(makeSandboxRepo('schema-invalid.yaml'));
    expect(() => detectNewExternalAgents(repo.repoRoot)).toThrowError(
      /invalid external-agents\.yaml/i,
    );
    expect(existsSync(repo.snapshotPath)).toBe(false);
  });

  it('throws on a malformed snapshot file rather than re-flagging every entry', () => {
    const repo = track(makeSandboxRepo('valid.yaml'));
    mkdirSync(dirname(repo.snapshotPath), { recursive: true });
    writeFileSync(repo.snapshotPath, '{ "version": "wrong" }', 'utf8');
    expect(() => detectNewExternalAgents(repo.repoRoot)).toThrowError(
      /malformed external-agents snapshot/i,
    );
  });

  it('rejects a relative repoRoot', () => {
    expect(() => detectNewExternalAgents('relative/path')).toThrowError(
      /must be absolute/i,
    );
  });

  it('honours override configPath / snapshotPath when supplied', () => {
    const repo = track(makeSandboxRepo());
    const altConfig = join(repo.repoRoot, 'alt', 'agents.yaml');
    const altSnapshot = join(repo.repoRoot, 'alt', 'snapshot.json');
    mkdirSync(dirname(altConfig), { recursive: true });
    copyFileSync(fixturePath('valid.yaml'), altConfig);

    const result = detectNewExternalAgents(repo.repoRoot, {
      configPath: altConfig,
      snapshotPath: altSnapshot,
    });
    expect(result.configPath).toBe(altConfig);
    expect(result.snapshotPath).toBe(altSnapshot);
    expect(result.rows).toHaveLength(3);
    expect(existsSync(altSnapshot)).toBe(true);
    expect(existsSync(defaultExternalAgentsSnapshotPath(repo.repoRoot))).toBe(false);
  });

  it('diffExternalAgentEntries identifies entries by `name`', () => {
    const prior = [
      { name: 'a', repo: 'x', capabilities: [], suggested_call_sites: [] },
      { name: 'b', repo: 'y', capabilities: [], suggested_call_sites: [] },
    ];
    const current = [
      { name: 'a', repo: 'x', capabilities: ['changed'], suggested_call_sites: [] },
      { name: 'c', repo: 'z', capabilities: [], suggested_call_sites: [] },
    ];
    expect(diffExternalAgentEntries(prior, current).map((e) => e.name)).toEqual(['c']);
  });

  it('preserves the on-disk snapshot shape end-to-end', () => {
    const repo = track(makeSandboxRepo('valid.yaml'));
    detectNewExternalAgents(repo.repoRoot);
    const raw = readFileSync(repo.snapshotPath, 'utf8');
    const parsed = JSON.parse(raw) as ExternalAgentsSnapshot;
    expect(parsed.version).toBe(1);
    expect(parsed.configPath).toBe(repo.configPath);
    expect(typeof parsed.capturedAt).toBe('string');
    expect(parsed.mcp_servers).toHaveLength(2);
    expect(parsed.agent_manifests).toHaveLength(1);
  });
});

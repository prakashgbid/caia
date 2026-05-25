import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockBackend, NullBackend } from '../src/metric-collector.js';
import { run } from '../src/run.js';
import type { MetricSeries, OutcomeEvent } from '../src/types.js';

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'outcome-steward-run-'));
}

async function scaffoldPackage(
  packagesRoot: string,
  pkgName: string,
  expectedSli: Array<{
    metric: string;
    query: string;
    threshold: number;
    direction: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';
    trendDirection?: 'up' | 'down' | 'flat' | 'any';
    optional?: boolean;
  }>,
  solutionId?: string,
): Promise<void> {
  const folder = pkgName.replace('@caia/', '');
  const pkgDir = path.join(packagesRoot, folder);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: pkgName,
      caia: {
        outcome: {
          ...(solutionId !== undefined ? { solutionId } : {}),
          expectedSli,
        },
      },
    }),
  );
}

describe('run() — top-level orchestrator', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('emits no-metric-store.warning when NullBackend is in play', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [
      { metric: 'pkg:m', query: 'q', threshold: 1, direction: 'gt' },
    ]);
    const events: OutcomeEvent[] = [];
    const result = await run({
      backend: new NullBackend(),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 1,
      quiet: true,
      emit: (e) => events.push(e),
      now: () => new Date('2026-05-25T00:00:00Z'),
    });
    expect(result.run.backend).toBe('absent');
    expect(events.map((e) => e.type)).toContain('outcome-steward.no-metric-store.warning');
    expect(result.inboxAppended).toBe(false);
  });

  it('writes JSONL + status.json + INBOX on a red run', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [
      { metric: 'pkg:m', query: 'q', threshold: 1, direction: 'gt' },
    ]);
    const result = await run({
      backend: new MockBackend({ series: new Map() }), // present but empty
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 1,
      quiet: true,
      now: () => new Date('2026-05-25T00:00:00Z'),
    });
    expect(result.run.summary.red).toBe(1);
    expect(result.inboxAppended).toBe(true);

    const jsonl = await fs.readFile(path.join(dir, 'runs.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n')).toHaveLength(1);

    const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
    expect(status.summary.red).toBe(1);

    const inbox = await fs.readFile(path.join(dir, 'INBOX.md'), 'utf8');
    expect(inbox).toContain('## OUTCOME-STEWARD FAILURES');
  });

  it('emits green on a healthy run with above-threshold value', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [
      { metric: 'pkg:m', query: 'q', threshold: 1, direction: 'gt' },
    ]);
    const series: MetricSeries = {
      query: 'q',
      metric: 'pkg:m',
      samples: [[100, 2], [200, 3], [300, 4]],
      labels: {},
    };
    const result = await run({
      backend: new MockBackend({ series: new Map([['q', series]]) }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
      now: () => new Date('2026-05-25T00:00:00Z'),
    });
    expect(result.run.summary.green).toBe(1);
    expect(result.inboxAppended).toBe(false);
    expect(result.greenCount).toBe(1);
    const attJsonl = await fs.readFile(path.join(dir, 'att.jsonl'), 'utf8');
    expect(attJsonl.trim().split('\n')).toHaveLength(1);
  });

  it('honours --dry-run (writes nothing, still computes)', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [
      { metric: 'pkg:m', query: 'q', threshold: 1, direction: 'gt' },
    ]);
    const result = await run({
      backend: new MockBackend({ series: new Map() }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
      dryRun: true,
    });
    expect(result.run.summary.red).toBeGreaterThan(0);
    await expect(fs.access(path.join(dir, 'runs.jsonl'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'status.json'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'att.jsonl'))).rejects.toThrow();
  });

  it('runs cleanly with zero packages declared', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    const result = await run({
      backend: new MockBackend({ series: new Map() }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
    });
    expect(result.run.attestations).toEqual([]);
  });

  it('produces a no-metric-declared row for manifest entries with no declarations', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    // Manifest declares @caia/y but no expectedSli scaffolded for it.
    const manifestPath = path.join(dir, 'manifest.yaml');
    await fs.writeFile(
      manifestPath,
      'schema_version: 1\nentries:\n  - name: "@caia/y"\n    solutionId: "sol-y"\n',
    );
    const result = await run({
      backend: new MockBackend({ series: new Map() }),
      packagesRoot,
      deployManifestPath: manifestPath,
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
    });
    expect(result.run.summary.noMetricDeclared).toBe(1);
    // It should NOT show up as a red.
    expect(result.run.summary.red).toBe(0);
    // And no INBOX failure.
    expect(result.inboxAppended).toBe(false);
  });

  it('yellow path: threshold ok but trend wrong → not red', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [
      { metric: 'pkg:m', query: 'q', threshold: 1, direction: 'gt', trendDirection: 'down' },
    ]);
    // ascending values: threshold ok but trend = up, expected = down.
    const series: MetricSeries = {
      query: 'q',
      metric: 'pkg:m',
      samples: [[0, 2], [1, 3], [2, 4]],
      labels: {},
    };
    const result = await run({
      backend: new MockBackend({ series: new Map([['q', series]]) }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      attestationsJsonlPath: path.join(dir, 'att.jsonl'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
      now: () => new Date('2026-05-25T00:00:00Z'),
    });
    expect(result.run.summary.yellow).toBe(1);
    expect(result.run.summary.red).toBe(0);
    expect(result.inboxAppended).toBe(false);
  });
});

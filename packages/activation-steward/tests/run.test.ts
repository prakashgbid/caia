import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { MockBackend, NullBackend } from '../src/trace-collector.js';
import type { ActivationEvent, TraceMatch } from '../src/types.js';

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'activation-steward-run-'));
}

async function scaffoldPackage(
  packagesRoot: string,
  pkgName: string,
  callpaths: Array<{ path: string; serviceName: string; spanName?: string; optional?: boolean }>,
): Promise<void> {
  const folder = pkgName.replace('@caia/', '');
  const pkgDir = path.join(packagesRoot, folder);
  await fs.mkdir(pkgDir, { recursive: true });
  await fs.writeFile(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: pkgName,
      caia: { activation: { expectedCallPaths: callpaths } },
    }),
  );
}

function span(overrides: Partial<TraceMatch> = {}): TraceMatch {
  return {
    serviceName: 'svc',
    spanName: 'fn',
    tenantId: 't1',
    callpath: 'svc:fn',
    traceId: 'tr',
    spanId: 'sp',
    timestamp: new Date('2026-05-24T17:00:00Z'),
    status: 'ok',
    attributes: {},
    ...overrides,
  };
}

describe('run() — top-level orchestrator', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('emits no-telemetry.warning when NullBackend is in play', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [{ path: 'svc:fn', serviceName: 'svc' }]);
    const events: ActivationEvent[] = [];
    const result = await run({
      backend: new NullBackend(),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 1,
      quiet: true,
      emit: (e) => events.push(e),
      now: () => new Date('2026-05-24T18:00:00Z'),
    });
    expect(result.run.telemetry).toBe('absent');
    expect(events.map((e) => e.type)).toContain('activation-steward.no-telemetry.warning');
    // No-telemetry should NOT write red INBOX entries
    expect(result.inboxAppended).toBe(false);
  });

  it('writes JSONL + status.json + INBOX on a red run', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [{ path: 'svc:fn', serviceName: 'svc' }]);
    const result = await run({
      backend: new MockBackend({ matches: [] }), // present but empty
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 1,
      quiet: true,
      now: () => new Date('2026-05-24T18:00:00Z'),
    });
    expect(result.run.summary.red).toBe(1);
    expect(result.inboxAppended).toBe(true);

    const jsonl = await fs.readFile(path.join(dir, 'runs.jsonl'), 'utf8');
    expect(jsonl.trim().split('\n')).toHaveLength(1);

    const status = JSON.parse(await fs.readFile(path.join(dir, 'status.json'), 'utf8'));
    expect(status.summary.red).toBe(1);

    const inbox = await fs.readFile(path.join(dir, 'INBOX.md'), 'utf8');
    expect(inbox).toContain('## ACTIVATION-STEWARD FAILURES');
  });

  it('emits green on a healthy run with matching spans', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [{ path: 'svc:fn', serviceName: 'svc' }]);
    const result = await run({
      backend: new MockBackend({ matches: [span()] }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
      now: () => new Date('2026-05-24T18:00:00Z'),
    });
    expect(result.run.summary.green).toBe(1);
    expect(result.inboxAppended).toBe(false);
  });

  it('honours --dry-run (writes nothing, still computes)', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    await scaffoldPackage(packagesRoot, '@caia/x', [{ path: 'svc:fn', serviceName: 'svc' }]);
    const result = await run({
      backend: new MockBackend({ matches: [] }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
      dryRun: true,
    });
    expect(result.run.summary.red).toBeGreaterThan(0);
    // No filesystem side effects
    await expect(fs.access(path.join(dir, 'runs.jsonl'))).rejects.toThrow();
    await expect(fs.access(path.join(dir, 'status.json'))).rejects.toThrow();
  });

  it('still computes a row when there are zero packages', async () => {
    const packagesRoot = path.join(dir, 'packages');
    await fs.mkdir(packagesRoot);
    const result = await run({
      backend: new MockBackend({ matches: [] }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'test',
      windowHours: 24,
      quiet: true,
    });
    expect(result.run.attestations).toEqual([]);
  });
});

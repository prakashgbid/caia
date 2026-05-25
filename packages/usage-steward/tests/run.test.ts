import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import type { ScannerKind, ScannerResult, ScannerRunner, UsageEvent } from '../src/types.js';

let TMP: string;
beforeEach(async () => { TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'us-run-')); });
afterEach(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

async function fixtureMonorepo(): Promise<{ packagesRoot: string; runsJsonl: string; statusJson: string; attestJsonl: string; inbox: string }> {
  const packagesRoot = path.join(TMP, 'packages');
  await fs.mkdir(packagesRoot, { recursive: true });
  // Two synthetic packages.
  for (const name of ['alpha','beta']) {
    const d = path.join(packagesRoot, name);
    await fs.mkdir(d, { recursive: true });
    await fs.writeFile(path.join(d, 'package.json'), JSON.stringify({ name: `@caia/${name}` }, null, 2));
  }
  return {
    packagesRoot,
    runsJsonl: path.join(TMP, 'runs.jsonl'),
    statusJson: path.join(TMP, 'status.json'),
    attestJsonl: path.join(TMP, 'attestations.jsonl'),
    inbox: path.join(TMP, 'INBOX.md'),
  };
}

const cleanRunner: ScannerRunner = async (scanner: ScannerKind): Promise<ScannerResult> => ({
  scanner, tooling: 'present', findings: [], durationMs: 1,
});

const orphanRunner: ScannerRunner = async (scanner: ScannerKind): Promise<ScannerResult> => {
  if (scanner === 'knip') {
    return {
      scanner, tooling: 'present', durationMs: 1,
      findings: [{ scanner: 'knip', kind: 'unused-file', severity: 'error', packageName: null, filePath: '/x', symbol: null, dependency: null, message: 'orphan' }],
    };
  }
  return { scanner, tooling: 'present', findings: [], durationMs: 1 };
};

describe('run', () => {
  it('runs all-green when scanner runner emits no findings', async () => {
    const f = await fixtureMonorepo();
    const events: UsageEvent[] = [];
    const r = await run({
      packagesRoot: f.packagesRoot,
      runsJsonlPath: f.runsJsonl, statusJsonPath: f.statusJson, attestationsJsonlPath: f.attestJsonl,
      inboxPath: f.inbox, deployManifestPath: path.join(TMP, 'no-manifest.yaml'),
      runScanner: cleanRunner, emit: (e) => events.push(e), quiet: true,
    });
    expect(r.run.summary.green).toBe(2);
    expect(r.run.summary.red).toBe(0);
    expect(r.newGreenIds.length).toBe(2);
    expect(events.some((e) => e.type === 'usage-steward.run.completed')).toBe(true);
  });

  it('flags packages red when they are declared-shipped + scanner finds orphans', async () => {
    const f = await fixtureMonorepo();
    // Author a deploy manifest that lists both packages → orphan findings turn red.
    const manifest = path.join(TMP, 'deploy.yaml');
    await fs.writeFile(manifest, `schema_version: 1\nentries:\n  - name: "@caia/alpha"\n  - name: "@caia/beta"\n`);
    const r = await run({
      packagesRoot: f.packagesRoot,
      runsJsonlPath: f.runsJsonl, statusJsonPath: f.statusJson, attestationsJsonlPath: f.attestJsonl,
      inboxPath: f.inbox, deployManifestPath: manifest,
      runScanner: orphanRunner, quiet: true,
    });
    expect(r.run.summary.red).toBeGreaterThan(0);
    expect(r.inboxAppended).toBe(true);
  });

  it('dry-run skips all disk writes + bus emits', async () => {
    const f = await fixtureMonorepo();
    const r = await run({
      packagesRoot: f.packagesRoot,
      runsJsonlPath: f.runsJsonl, statusJsonPath: f.statusJson, attestationsJsonlPath: f.attestJsonl,
      inboxPath: f.inbox, deployManifestPath: path.join(TMP, 'no.yaml'),
      runScanner: cleanRunner, dryRun: true, quiet: true,
    });
    expect(r.eventsEmitted).toBe(0);
    expect(await fs.access(f.runsJsonl).then(() => true, () => false)).toBe(false);
  });

  it('restricts to --only when set', async () => {
    const f = await fixtureMonorepo();
    const r = await run({
      packagesRoot: f.packagesRoot,
      runsJsonlPath: f.runsJsonl, statusJsonPath: f.statusJson, attestationsJsonlPath: f.attestJsonl,
      inboxPath: f.inbox, deployManifestPath: path.join(TMP, 'no.yaml'),
      runScanner: cleanRunner, only: ['@caia/alpha'], quiet: true,
    });
    expect(r.run.attestations).toHaveLength(1);
    expect(r.run.attestations[0]?.packageName).toBe('@caia/alpha');
  });
});

/**
 * Integration test #2 — simulated cold-path injection.
 *
 * Sets up a scratch package with a declared `expected_call_paths` entry
 * that NO span ever fires. Runs the steward end-to-end. Confirms:
 *   1. attestation row is `red`
 *   2. INBOX gains a `## ACTIVATION-STEWARD FAILURES` entry
 *   3. event-bus emits a `cold-path.detected` event for the path
 *
 * This is the "cold-path injection" check called out in the spec's
 * verification requirements (Task A5 first-green criterion).
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { run } from '../src/run.js';
import { MockBackend } from '../src/trace-collector.js';
import type { ActivationEvent } from '../src/types.js';

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'activation-steward-int-cold-'));
}

describe('integration #2 — simulated cold-path injection', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('flags a declared-but-never-called path as red within one cycle', async () => {
    // 1. Scratch packages root with a single package that declares
    //    a path no span ever exercises.
    const packagesRoot = path.join(dir, 'packages');
    const pkgDir = path.join(packagesRoot, 'phantom');
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@caia/phantom',
        caia: {
          activation: {
            expectedCallPaths: [
              { path: '@caia/phantom:Phantom.ghost', serviceName: 'phantom-svc' },
            ],
          },
        },
      }),
    );

    // 2. Backend present but returns nothing.
    const backend = new MockBackend({ matches: [] });

    const events: ActivationEvent[] = [];
    const result = await run({
      backend,
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'integration-cold-path',
      windowHours: 1,
      quiet: true,
      emit: (e) => events.push(e),
    });

    // 3. Red attestation
    expect(result.run.summary.red).toBe(1);
    expect(result.run.attestations[0]!.status).toBe('red');

    // 4. INBOX appended
    expect(result.inboxAppended).toBe(true);
    const inbox = await fs.readFile(path.join(dir, 'INBOX.md'), 'utf8');
    expect(inbox).toContain('## ACTIVATION-STEWARD FAILURES');
    expect(inbox).toContain('@caia/phantom');
    expect(inbox).toContain('@caia/phantom:Phantom.ghost');

    // 5. Cold-path event fired
    const cold = events.filter((e) => e.type === 'activation-steward.cold-path.detected');
    expect(cold).toHaveLength(1);
    expect(cold[0]!.payload.callpath).toBe('@caia/phantom:Phantom.ghost');
    expect(cold[0]!.payload.packageName).toBe('@caia/phantom');
  });

  it('clears red status on the next run once spans appear', async () => {
    const packagesRoot = path.join(dir, 'packages');
    const pkgDir = path.join(packagesRoot, 'thaw');
    await fs.mkdir(pkgDir, { recursive: true });
    await fs.writeFile(
      path.join(pkgDir, 'package.json'),
      JSON.stringify({
        name: '@caia/thaw',
        caia: {
          activation: {
            expectedCallPaths: [
              { path: '@caia/thaw:Frost.melt', serviceName: 'thaw-svc' },
            ],
          },
        },
      }),
    );

    // First run — cold.
    const cold = await run({
      backend: new MockBackend({ matches: [] }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'integration-cold-path',
      windowHours: 1,
      quiet: true,
    });
    expect(cold.run.summary.red).toBe(1);

    // Second run — same package, now spans land.
    const warm = await run({
      backend: new MockBackend({
        matches: [{
          serviceName: 'thaw-svc',
          spanName: 'Frost.melt',
          tenantId: 't1',
          callpath: '@caia/thaw:Frost.melt',
          traceId: 'tr1',
          spanId: 'sp1',
          timestamp: new Date(),
          status: 'ok',
          attributes: {},
        }],
      }),
      packagesRoot,
      deployManifestPath: path.join(dir, 'missing.yaml'),
      runsJsonlPath: path.join(dir, 'runs.jsonl'),
      statusJsonPath: path.join(dir, 'status.json'),
      inboxPath: path.join(dir, 'INBOX.md'),
      site: 'integration-cold-path',
      windowHours: 1,
      quiet: true,
    });
    expect(warm.run.summary.green).toBe(1);
    expect(warm.run.summary.red).toBe(0);
  });
});

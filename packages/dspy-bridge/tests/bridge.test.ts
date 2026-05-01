import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

import { DspyBridge, DspyBridgeError } from '../src/bridge.js';

/**
 * The bridge tests don't require `uv` or DSPy — instead we point the
 * bridge at a hand-rolled "fake server" that speaks the same JSONL
 * protocol. This keeps the unit tests fast and hermetic, while the
 * Python side is exercised by the `py:smoke` script and the integration
 * suite that lands with PR2.
 */

interface FakeServerHarness {
  fakePythonDir: string;
  uvBin: string;
  cleanup: () => void;
}

function buildFakeServer(): FakeServerHarness {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dspy-bridge-fakesrv-'));
  const fakePythonDir = path.join(tmp, 'python');
  fs.mkdirSync(fakePythonDir, { recursive: true });

  // Minimal JSONL echo server: handles ping, predict (echoes input as
  // output), shutdown.
  const serverJs = path.join(tmp, 'fake-server.mjs');
  fs.writeFileSync(
    serverJs,
    `import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (raw) => {
  const line = raw.trim();
  if (!line) return;
  const req = JSON.parse(line);
  let resp;
  if (req.method === 'ping') {
    resp = { id: req.id, ok: true, result: { pong: true, pyVersion: 'fake', dspyVersion: 'fake', uptimeMs: 0 } };
  } else if (req.method === 'predict') {
    resp = { id: req.id, ok: true, result: { output: { echoed: req.params.input }, model: 'fake-model', durationMs: 1 } };
  } else if (req.method === 'list_programs') {
    resp = { id: req.id, ok: true, result: { programs: [] } };
  } else if (req.method === 'shutdown') {
    process.stdout.write(JSON.stringify({ id: req.id, ok: true, result: { bye: true } }) + '\\n');
    process.exit(0);
  } else {
    resp = { id: req.id, ok: false, error: { code: 'unknown-method', message: req.method } };
  }
  process.stdout.write(JSON.stringify(resp) + '\\n');
});`,
    'utf8',
  );

  // Fake uv: drop the 'run --directory <dir> python -m caia_dspy_bridge.server'
  // and exec node with the fake server.
  const uvBin = path.join(tmp, 'uv');
  fs.writeFileSync(
    uvBin,
    `#!/usr/bin/env bash\nexec node ${serverJs} "$@"\n`,
    { mode: 0o755 },
  );

  return {
    fakePythonDir,
    uvBin,
    cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

describe('DspyBridge (with a fake server)', () => {
  let harness: FakeServerHarness;
  let bridge: DspyBridge;

  beforeEach(() => {
    harness = buildFakeServer();
    bridge = new DspyBridge({
      uvBin: harness.uvBin,
      pythonDir: harness.fakePythonDir,
      defaultTimeoutMs: 5_000,
    });
  });

  afterEach(async () => {
    await bridge.stop().catch(() => undefined);
    harness.cleanup();
  });

  it('start() spawns the server and ping resolves', async () => {
    await bridge.start();
    const r = await bridge.ping();
    expect(r.pong).toBe(true);
    expect(r.dspyVersion).toBe('fake');
  });

  it('start() is idempotent', async () => {
    const a = bridge.start();
    const b = bridge.start();
    expect(a).toBe(b);
    await Promise.all([a, b]);
    await bridge.ping();
  });

  it('predict() round-trips typed input/output', async () => {
    await bridge.start();
    const out = await bridge.predict({
      program: 'po-scope-detector',
      version: 'latest',
      input: { promptText: 'add a logout button' },
    });
    expect(out.model).toBe('fake-model');
    expect(out.output).toEqual({
      echoed: { promptText: 'add a logout button' },
    });
  });

  it('listPrograms() returns an empty list against an empty registry', async () => {
    await bridge.start();
    const r = await bridge.listPrograms();
    expect(r.programs).toEqual([]);
  });

  it('throws DspyBridgeError on unknown method (typed code field)', async () => {
    await bridge.start();
    // Cast through `any` to exercise the protocol error path.
    const callPriv = (bridge as unknown as {
      callWithTimeout: (m: string, p: unknown, t: number) => Promise<unknown>;
    }).callWithTimeout.bind(bridge);
    await expect(callPriv('not_a_method', {}, 2_000)).rejects.toMatchObject({
      name: 'DspyBridgeError',
      code: 'unknown-method',
    });
  });

  it('throws DspyBridgeError("no-python-dir") when pythonDir is missing', async () => {
    const broken = new DspyBridge({
      uvBin: harness.uvBin,
      pythonDir: '/no/such/dir/dspy-bridge-test',
    });
    await expect(broken.start()).rejects.toMatchObject({
      name: 'DspyBridgeError',
      code: 'no-python-dir',
    });
    void DspyBridgeError; // keep import live
  });
});

/**
 * CODING-007 — IPC server tests.
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import { IpcServer, ipcCall, defaultSocketPath } from '../src/ipc-server';
import type { IpcHandlers, FixRequest, FixResultOut } from '../src/ipc-server';

function tmpSocket(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caia-ipc-'));
  return path.join(dir, `${name}.sock`);
}

function makeHandlers(overrides: Partial<IpcHandlers> = {}): IpcHandlers {
  return {
    applyFix: async (_req: FixRequest): Promise<FixResultOut> => ({
      status: 'fix-applied',
      sha: 'abc123',
      turns: 1,
      totalTokens: { input: 10, output: 20 },
    }),
    getStatus: () => ({ status: 'idle', currentStoryId: null }),
    flushLogs: () => ['log line 1', 'log line 2'],
    shutdown: async () => {},
    ...overrides,
  };
}

describe('defaultSocketPath', () => {
  it('points at ~/.caia/sockets/<workerId>.sock', () => {
    const p = defaultSocketPath('wkr_abc');
    expect(p).toContain('.caia');
    expect(p).toContain('sockets');
    expect(p.endsWith('wkr_abc.sock')).toBe(true);
  });
});

describe('IpcServer lifecycle', () => {
  it('start() creates the socket file and stop() removes it', async () => {
    const sock = tmpSocket('lifecycle');
    const server = new IpcServer({ workerId: 'wkr_lifecycle', handlers: makeHandlers(), socketPath: sock });
    await server.start();
    expect(fs.existsSync(sock)).toBe(true);
    expect(server.isListening()).toBe(true);
    await server.stop();
    expect(fs.existsSync(sock)).toBe(false);
    expect(server.isListening()).toBe(false);
  });

  it('start() unlinks a stale socket file left by a previous crash', async () => {
    const sock = tmpSocket('stale');
    fs.writeFileSync(sock, '');
    expect(fs.existsSync(sock)).toBe(true);
    const fresh = new IpcServer({ workerId: 'wkr_fresh', handlers: makeHandlers(), socketPath: sock });
    await fresh.start();
    expect(fresh.isListening()).toBe(true);
    await fresh.stop();
  });

  it('start() and stop() are idempotent', async () => {
    const sock = tmpSocket('idempotent');
    const server = new IpcServer({ workerId: 'wkr_idem', handlers: makeHandlers(), socketPath: sock });
    await server.start();
    await server.start();
    expect(server.isListening()).toBe(true);
    await server.stop();
    await server.stop();
    expect(server.isListening()).toBe(false);
  });
});

describe('IpcServer methods', () => {
  let server: IpcServer;
  let sock: string;
  let appliedFix: FixRequest | null = null;
  let shutdownCalled = false;
  let getStatusReturn: { status: 'idle' | 'busy' | 'shutting-down'; currentStoryId: string | null } = {
    status: 'idle',
    currentStoryId: null,
  };

  beforeEach(async () => {
    sock = tmpSocket('methods');
    appliedFix = null;
    shutdownCalled = false;
    getStatusReturn = { status: 'idle', currentStoryId: null };
    server = new IpcServer({
      workerId: 'wkr_test',
      socketPath: sock,
      handlers: {
        applyFix: async (req) => {
          appliedFix = req;
          return { status: 'fix-applied', sha: 'sha_' + req.testCaseId, turns: 2, totalTokens: { input: 5, output: 6 } };
        },
        getStatus: () => getStatusReturn,
        flushLogs: () => ['line 1', 'line 2', 'line 3'],
        shutdown: async () => {
          shutdownCalled = true;
        },
      },
      now: () => 1_000_000,
    });
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  it('apply_fix forwards params + returns the engine result', async () => {
    const result = await ipcCall<FixResultOut>(sock, 'apply_fix', {
      testCaseId: 'tc_42',
      whatFailed: 'expected 200, got 500',
      hypothesis: 'auth header missing',
    });
    expect(result.status).toBe('fix-applied');
    expect(result.sha).toBe('sha_tc_42');
    expect(appliedFix?.testCaseId).toBe('tc_42');
  });

  it('health returns workerId, status, and uptime', async () => {
    getStatusReturn = { status: 'busy', currentStoryId: 'story_99' };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (server as any).now = () => 1_000_500;
    const out = await ipcCall<{
      ok: boolean;
      status: string;
      workerId: string;
      currentStoryId: string | null;
      uptimeMs: number;
    }>(sock, 'health');
    expect(out.ok).toBe(true);
    expect(out.workerId).toBe('wkr_test');
    expect(out.status).toBe('busy');
    expect(out.currentStoryId).toBe('story_99');
    expect(out.uptimeMs).toBe(500);
  });

  it('flush_logs returns the buffered log lines', async () => {
    const out = await ipcCall<{ lines: string[] }>(sock, 'flush_logs');
    expect(out.lines).toEqual(['line 1', 'line 2', 'line 3']);
  });

  it('shutdown invokes the host shutdown handler and returns graceful=true', async () => {
    const out = await ipcCall<{ graceful: boolean }>(sock, 'shutdown');
    expect(out.graceful).toBe(true);
    await new Promise((r) => setImmediate(r));
    expect(shutdownCalled).toBe(true);
  });

  it('rejects unknown methods', async () => {
    await expect(ipcCall(sock, 'launch_missiles', {})).rejects.toThrow(/unknown method/);
  });

  it('rejects apply_fix without required params', async () => {
    await expect(
      ipcCall(sock, 'apply_fix', { testCaseId: 'tc' }),
    ).rejects.toThrow(/whatFailed/);
  });

  it('rejects malformed JSON without crashing the server', async () => {
    await new Promise<void>((resolve, reject) => {
      const s = net.createConnection(sock, () => { s.write('not json\n'); });
      let buf = '';
      s.on('data', (d) => {
        buf += d.toString();
        if (buf.includes('\n')) {
          try {
            const resp = JSON.parse(buf.trim().split('\n')[0]!);
            expect(resp.ok).toBe(false);
            expect(resp.error.code).toBe('invalid-json');
            s.end();
            resolve();
          } catch (e) { reject(e); }
        }
      });
      s.on('error', reject);
    });
    const out = await ipcCall<{ ok: boolean }>(sock, 'health');
    expect(out.ok).toBe(true);
  });

  it('serialises responses by request id', async () => {
    const a = ipcCall<FixResultOut>(sock, 'apply_fix', { testCaseId: 'tc_a', whatFailed: 'A', hypothesis: 'A' });
    const b = ipcCall<FixResultOut>(sock, 'apply_fix', { testCaseId: 'tc_b', whatFailed: 'B', hypothesis: 'B' });
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.sha).toBe('sha_tc_a');
    expect(rb.sha).toBe('sha_tc_b');
  });

  it('second shutdown reports already-shutting-down', async () => {
    await ipcCall(sock, 'shutdown');
    await expect(ipcCall(sock, 'shutdown')).rejects.toThrow(/already shutting down/);
  });
});

describe('ipcCall error paths', () => {
  it('rejects when the socket is unreachable', async () => {
    const sock = path.join(os.tmpdir(), `caia-no-such-${Date.now()}.sock`);
    await expect(ipcCall(sock, 'health')).rejects.toThrow();
  });

  it('rejects on timeout', async () => {
    const sock = tmpSocket('timeout');
    const server = new IpcServer({
      workerId: 'wkr_timeout',
      socketPath: sock,
      handlers: makeHandlers({
        applyFix: async () => {
          await new Promise((r) => setTimeout(r, 200));
          return { status: 'fix-applied', sha: 's', turns: 1, totalTokens: { input: 0, output: 0 } };
        },
      }),
    });
    await server.start();
    try {
      await expect(
        ipcCall(sock, 'apply_fix', { testCaseId: 't', whatFailed: 'x', hypothesis: 'y' }, { timeoutMs: 50 }),
      ).rejects.toThrow(/ipc timeout/);
    } finally {
      await server.stop();
    }
  });
});

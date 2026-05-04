/**
 * `CodingIpcClient` — FIX-005 contract tests.
 *
 * Two implementations under test:
 *
 *   1. `MemoryCodingIpcInvoker` — in-process mock; the FixIt
 *      Orchestrator's default until CODING-007 ships the real server.
 *   2. `UnixSocketCodingIpcClient` — exercised against a tiny test
 *      server we spin up on a temp socket so we can prove the wire
 *      format end-to-end without depending on CODING-007.
 *
 * The test server is intentionally minimal — it just accepts a line,
 * parses the request, and replies with whatever the test handed it as
 * the canned response. That isolates the client's framing + dispatch
 * + timeout behaviour from any business logic the real server will
 * carry.
 */

import { createServer, Server, Socket } from 'net';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MemoryCodingIpcInvoker,
  UnixSocketCodingIpcClient,
  socketPathForWorker,
  type IpcRequest,
  type IpcResponse,
} from '../src/coding-ipc-client';
import type { FixRequest } from '../src/types';

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeFixRequest(overrides: Partial<FixRequest> = {}): FixRequest {
  return {
    storyId: 'story_1',
    testCaseId: 'tc1',
    attempt: 1,
    whatFailed: 'expected /dashboard, got /login',
    hypothesisFromDiagnoser: 'session cookie missing',
    testCaseSpecPath: '/tmp/spec.ts',
    hintFiles: [],
    preserveScopeOf: 'fix-only',
    ...overrides,
  };
}

interface TestServerHandle {
  socketPath: string;
  server: Server;
  sockets: Set<Socket>;
  /**
   * Set this to control the responses the server emits. The handler
   * receives every parsed request line and decides what to send back.
   * Returning `null` skips a response (useful for timeout tests).
   */
  handler: (req: IpcRequest) => IpcResponse | null;
  cleanup: () => Promise<void>;
}

async function startTestServer(): Promise<TestServerHandle> {
  const dir = mkdtempSync(join(tmpdir(), 'caia-fix-005-srv-'));
  const socketPath = join(dir, 'sock');
  const sockets = new Set<Socket>();
  const handle: TestServerHandle = {
    socketPath,
    server: createServer(),
    sockets,
    handler: () => ({ id: 'unused', ok: true }),
    cleanup: async () => {
      for (const s of sockets) {
        try {
          s.destroy();
        } catch {
          // ignore
        }
      }
      await new Promise<void>((r) => handle.server.close(() => r()));
    },
  };
  handle.server.on('connection', (sock) => {
    sockets.add(sock);
    let buf = '';
    sock.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        let req: IpcRequest;
        try {
          req = JSON.parse(line);
        } catch {
          continue;
        }
        const resp = handle.handler(req);
        if (resp) {
          // Echo the request id so the client matches it.
          const reply: IpcResponse = { ...resp, id: req.id };
          sock.write(`${JSON.stringify(reply)}\n`);
        }
      }
    });
    sock.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => handle.server.listen(socketPath, () => resolve()));
  return handle;
}

/** Default ack response for non-`apply_fix` methods (close_session, etc.). */
const ACK = (req: IpcRequest): IpcResponse => ({ id: req.id, ok: true });

// ─── socketPathForWorker ────────────────────────────────────────────────────

describe('socketPathForWorker', () => {
  it('builds the canonical path under ~/.caia/sockets', () => {
    const path = socketPathForWorker('worker_abc');
    expect(path).toContain('.caia/sockets');
    expect(path.endsWith('worker_abc.sock')).toBe(true);
  });
  it('honours an explicit base directory', () => {
    expect(socketPathForWorker('w1', '/tmp/socks')).toBe('/tmp/socks/w1.sock');
  });
});

// ─── MemoryCodingIpcInvoker ─────────────────────────────────────────────────

describe('MemoryCodingIpcInvoker', () => {
  it('returns ok with a synthetic sha by default', async () => {
    const inv = new MemoryCodingIpcInvoker();
    const out = await inv.applyFix(makeFixRequest());
    expect(out.ok).toBe(true);
    expect(out.sha).toMatch(/^mem/);
    expect(out.summary).toContain('memory invoker fix #1');
    expect(inv.calls).toHaveLength(1);
  });

  it('respects the alwaysFix=false flag', async () => {
    const inv = new MemoryCodingIpcInvoker({ alwaysFix: false });
    const out = await inv.applyFix(makeFixRequest());
    expect(out.ok).toBe(false);
    expect(out.error).toContain('alwaysFix=false');
  });

  it('calls the custom respond hook when provided', async () => {
    const inv = new MemoryCodingIpcInvoker({
      respond: (req) => ({ ok: true, sha: 'custom1234567', summary: req.testCaseId }),
    });
    const out = await inv.applyFix(makeFixRequest({ testCaseId: 'tc-x' }));
    expect(out.sha).toBe('custom1234567');
    expect(out.summary).toBe('tc-x');
  });

  it('counts close-session calls', async () => {
    const inv = new MemoryCodingIpcInvoker();
    await inv.shutdown();
    await inv.shutdown();
    expect(inv.closeSessionCalls).toBe(2);
  });
});

// ─── UnixSocketCodingIpcClient — round-trip via the test server ─────────────

describe('UnixSocketCodingIpcClient', () => {
  let srv: TestServerHandle;
  beforeEach(async () => {
    srv = await startTestServer();
  });
  afterEach(async () => {
    await srv.cleanup();
  });

  it('round-trips apply_fix and lifts sha + summary from the response', async () => {
    srv.handler = (req) => {
      if (req.method !== 'apply_fix') return ACK(req);
      const params = req.params as FixRequest;
      expect(params.testCaseId).toBe('tc-rt');
      return { id: 'echo', ok: true, result: { sha: 'srv1234567', summary: 'fixed' } };
    };
    const client = new UnixSocketCodingIpcClient({ socketPath: srv.socketPath });
    const out = await client.applyFix(makeFixRequest({ testCaseId: 'tc-rt' }));
    expect(out.ok).toBe(true);
    expect(out.sha).toBe('srv1234567');
    expect(out.summary).toBe('fixed');
    await client.shutdown();
  });

  it('returns ok:false with the error when the server reports failure', async () => {
    srv.handler = (req) => {
      if (req.method !== 'apply_fix') return ACK(req);
      return { id: req.id, ok: false, error: 'sdk rate-limited' };
    };
    const client = new UnixSocketCodingIpcClient({ socketPath: srv.socketPath });
    const out = await client.applyFix(makeFixRequest());
    expect(out.ok).toBe(false);
    expect(out.error).toContain('rate-limited');
    await client.shutdown();
  });

  it('multiplexes concurrent requests by id', async () => {
    let received = 0;
    srv.handler = (req) => {
      if (req.method !== 'apply_fix') return ACK(req);
      received += 1;
      // Echo the test case id back so we can match outcomes to requests.
      return {
        id: req.id,
        ok: true,
        result: { sha: `s${received}1234567`, summary: (req.params as FixRequest).testCaseId },
      };
    };
    const client = new UnixSocketCodingIpcClient({ socketPath: srv.socketPath });
    const a = client.applyFix(makeFixRequest({ testCaseId: 'a' }));
    const b = client.applyFix(makeFixRequest({ testCaseId: 'b' }));
    const c = client.applyFix(makeFixRequest({ testCaseId: 'c' }));
    const [resA, resB, resC] = await Promise.all([a, b, c]);
    expect(resA.ok && resB.ok && resC.ok).toBe(true);
    // Summaries should match the test case ids; scrambled order is fine
    // because the wire protocol multiplexes by id.
    expect(new Set([resA.summary, resB.summary, resC.summary])).toEqual(
      new Set(['a', 'b', 'c']),
    );
    await client.shutdown();
  });

  it('returns ok:false with timeout error when the server does not reply', async () => {
    srv.handler = (req) => (req.method === 'apply_fix' ? null : ACK(req));
    const client = new UnixSocketCodingIpcClient({
      socketPath: srv.socketPath,
      requestTimeoutMs: 50,
    });
    const out = await client.applyFix(makeFixRequest());
    expect(out.ok).toBe(false);
    expect(out.error).toContain('ipc-timeout');
    expect(out.error).toContain('apply_fix');
    await client.shutdown();
  });

  it('returns ok:false with connect error when the socket does not exist', async () => {
    const client = new UnixSocketCodingIpcClient({
      socketPath: '/tmp/this-socket-is-not-real.sock',
      connectTimeoutMs: 50,
    });
    const out = await client.applyFix(makeFixRequest());
    expect(out.ok).toBe(false);
    expect(out.error?.length).toBeGreaterThan(0);
  });

  it('discards malformed lines on the wire', async () => {
    srv.handler = (req) => {
      if (req.method !== 'apply_fix') return ACK(req);
      // Send a malformed line first, then a real reply.
      const parent = [...srv.sockets][0];
      if (parent) parent.write('not json at all\n');
      return { id: req.id, ok: true, result: { sha: 'aft1234567' } };
    };
    const client = new UnixSocketCodingIpcClient({ socketPath: srv.socketPath });
    const out = await client.applyFix(makeFixRequest());
    expect(out.ok).toBe(true);
    expect(out.sha).toBe('aft1234567');
    await client.shutdown();
  });

  it('health() returns the server payload', async () => {
    srv.handler = (req) => {
      if (req.method !== 'health') return ACK(req);
      return {
        id: req.id,
        ok: true,
        result: { ok: true, sessionUptimeS: 42, lastSdkResponseAgeS: 3 },
      };
    };
    const client = new UnixSocketCodingIpcClient({ socketPath: srv.socketPath });
    const h = await client.health();
    expect(h.sessionUptimeS).toBe(42);
    expect(h.lastSdkResponseAgeS).toBe(3);
    await client.shutdown();
  });

  it('uses the documented default request timeout', () => {
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(120_000);
  });

  it('shutdown is best-effort and does not throw if the server closes', async () => {
    srv.handler = (req) => ({ id: req.id, ok: true });
    const client = new UnixSocketCodingIpcClient({ socketPath: srv.socketPath });
    await expect(client.shutdown()).resolves.toBeUndefined();
    // Calling shutdown a second time after the connection is gone is fine.
    await expect(client.shutdown()).resolves.toBeUndefined();
  });
});

// ─── fromEnv ────────────────────────────────────────────────────────────────

describe('UnixSocketCodingIpcClient.fromEnv', () => {
  it('returns null when no env points at a real socket', () => {
    const c = UnixSocketCodingIpcClient.fromEnv({});
    expect(c).toBeNull();
  });

  it('returns null when CODING_IPC_SOCKET points at a non-existent path', () => {
    const c = UnixSocketCodingIpcClient.fromEnv({
      CODING_IPC_SOCKET: '/tmp/this-is-not-real.sock',
    });
    expect(c).toBeNull();
  });

  it('returns a client when CODING_IPC_SOCKET points at a live socket', async () => {
    const srv = await startTestServer();
    try {
      const c = UnixSocketCodingIpcClient.fromEnv({
        CODING_IPC_SOCKET: srv.socketPath,
      });
      expect(c).not.toBeNull();
    } finally {
      await srv.cleanup();
    }
  });
});

/**
 * Worker IPC server — CODING-007 (Phase 2C).
 *
 * Each Coding Agent worker exposes a Unix-socket RPC endpoint at
 *   ~/.caia/sockets/<workerId>.sock
 * so the Fix-It Test Agent (Phase 2D) can drive the worker's per-story
 * `applyFix` loop without round-tripping through the orchestrator HTTP
 * API. The IPC contract is intentionally narrow: only operations that
 * are local to the worker process live here. Anything that touches the
 * shared orchestrator DB (assignment, status, heartbeat) goes through
 * the HTTP API instead.
 *
 * Wire format
 * -----------
 * Newline-delimited JSON, one request per line, one response per line.
 * Request:   { id: string, method: string, params: object }
 * Response:  { id: string, ok: true,  result: any }
 *         | { id: string, ok: false, error: { code: string, message: string } }
 *
 * Methods
 * -------
 *   apply_fix      — drive ImplementationEngine.applyFix() with one fix
 *                    request. Returns { status, sha, turns, totalTokens }.
 *   health         — { ok: true, status, currentStoryId, uptimeMs }
 *   flush_logs     — { lines: string[] } — last N captured log lines.
 *   shutdown       — { graceful: true } then close after responding.
 *
 * The server is cooperative — only one request at a time is handled per
 * connection; concurrent connections are accepted but apply_fix is
 * serialised in the engine itself (the SDK session can't be re-entered).
 *
 * @owner coding-agent (Phase 2C worker track)
 */

import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface IpcRequest {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface IpcSuccessResponse {
  id: string;
  ok: true;
  result: unknown;
}

export interface IpcErrorResponse {
  id: string;
  ok: false;
  error: { code: string; message: string };
}

export type IpcResponse = IpcSuccessResponse | IpcErrorResponse;

export interface FixRequest {
  testCaseId: string;
  whatFailed: string;
  hypothesis: string;
  testSpecPath?: string;
  artifactsRef?: { screenshotUrl?: string; tracePath?: string };
  hintFiles?: string[];
}

export interface FixResultOut {
  status: 'fix-applied' | 'turn-limit' | 'adapter-error';
  sha: string | null;
  turns: number;
  totalTokens: { input: number; output: number };
}

export interface HealthOut {
  ok: true;
  status: 'idle' | 'busy' | 'shutting-down';
  workerId: string;
  currentStoryId: string | null;
  uptimeMs: number;
}

export interface FlushLogsOut {
  lines: string[];
}

export interface ShutdownOut {
  graceful: true;
}

/**
 * Behaviour the IPC server expects from the host worker. Wired in
 * production by `main.ts` from the ImplementationEngine + a log-buffer.
 * Tests can supply a stub.
 */
export interface IpcHandlers {
  applyFix(req: FixRequest): Promise<FixResultOut>;
  getStatus(): { status: 'idle' | 'busy' | 'shutting-down'; currentStoryId: string | null };
  flushLogs(): string[];
  /**
   * Triggers the worker's graceful-shutdown routine. The server itself
   * waits until the response has been written before closing the socket.
   */
  shutdown(): Promise<void>;
}

export interface IpcServerOptions {
  workerId: string;
  handlers: IpcHandlers;
  /** Override for the socket path. Default: ~/.caia/sockets/<workerId>.sock */
  socketPath?: string;
  /** Override for Date.now() in tests. */
  now?: () => number;
}

// ─── Path helpers ───────────────────────────────────────────────────────────

export function defaultSocketPath(workerId: string): string {
  const dir = path.join(os.homedir(), '.caia', 'sockets');
  return path.join(dir, `${workerId}.sock`);
}

// ─── Server ─────────────────────────────────────────────────────────────────

export class IpcServer {
  private readonly workerId: string;
  private readonly handlers: IpcHandlers;
  private readonly socketPath: string;
  private readonly startedAt: number;
  private readonly now: () => number;
  private server: net.Server | null = null;
  private listening = false;
  private shuttingDown = false;

  constructor(opts: IpcServerOptions) {
    this.workerId = opts.workerId;
    this.handlers = opts.handlers;
    this.socketPath = opts.socketPath ?? defaultSocketPath(opts.workerId);
    this.now = opts.now ?? Date.now;
    this.startedAt = this.now();
  }

  get path(): string {
    return this.socketPath;
  }

  isListening(): boolean {
    return this.listening;
  }

  /**
   * Begins listening on the Unix socket. Creates the parent directory
   * if missing and unlinks any stale socket left by a previous crash.
   */
  async start(): Promise<void> {
    if (this.listening) return;
    const dir = path.dirname(this.socketPath);
    fs.mkdirSync(dir, { recursive: true });
    // Clean up stale socket / orphan file from a crashed previous instance.
    // Unix-domain bind() refuses any existing path, so unlink whatever
    // is there (socket, regular file, dangling symlink).
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // ENOENT is fine; anything else we let listen() surface.
    }
    return await new Promise<void>((resolve, reject) => {
      const server = net.createServer((socket) => this.handleConnection(socket));
      server.on('error', (err) => {
        if (!this.listening) reject(err);
      });
      server.listen(this.socketPath, () => {
        this.server = server;
        this.listening = true;
        // Restrict the socket to the user (no group/world). Best-effort —
        // some filesystems (e.g. NFS) refuse chmod on sockets.
        try {
          fs.chmodSync(this.socketPath, 0o600);
        } catch {
          // ignore
        }
        resolve();
      });
    });
  }

  /**
   * Stops the server and removes the socket file. Idempotent.
   */
  async stop(): Promise<void> {
    if (!this.listening) return;
    const server = this.server;
    this.listening = false;
    this.server = null;
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // ignore
    }
  }

  // ─── Connection handler ────────────────────────────────────────────────────

  private handleConnection(socket: net.Socket): void {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.trim().length === 0) continue;
        // Fire-and-forget: each request gets its own promise. Order is
        // preserved because we await before consuming the next line.
        void this.dispatch(line, socket);
      }
    });
    socket.on('error', () => {
      // Best-effort; client may have died mid-conversation.
    });
  }

  private async dispatch(line: string, socket: net.Socket): Promise<void> {
    let req: IpcRequest;
    try {
      req = JSON.parse(line);
    } catch (e) {
      this.write(socket, {
        id: 'unknown',
        ok: false,
        error: { code: 'invalid-json', message: (e as Error).message },
      });
      return;
    }
    if (!req || typeof req.id !== 'string' || typeof req.method !== 'string') {
      this.write(socket, {
        id: req?.id ?? 'unknown',
        ok: false,
        error: { code: 'invalid-request', message: 'id and method are required' },
      });
      return;
    }
    try {
      const result = await this.invoke(req);
      this.write(socket, { id: req.id, ok: true, result });
      if (req.method === 'shutdown') {
        // Close the socket after writing; the host process exits via
        // handlers.shutdown() (which is invoked synchronously above).
        socket.end();
      }
    } catch (e) {
      const err = e as Error & { code?: string };
      this.write(socket, {
        id: req.id,
        ok: false,
        error: {
          code: err.code ?? 'handler-error',
          message: err.message ?? String(err),
        },
      });
    }
  }

  private async invoke(req: IpcRequest): Promise<unknown> {
    switch (req.method) {
      case 'apply_fix': {
        const params = req.params as Partial<FixRequest> | undefined;
        if (!params || typeof params.testCaseId !== 'string') {
          throw Object.assign(new Error('apply_fix requires testCaseId'), { code: 'invalid-params' });
        }
        if (typeof params.whatFailed !== 'string' || typeof params.hypothesis !== 'string') {
          throw Object.assign(new Error('apply_fix requires whatFailed + hypothesis'), { code: 'invalid-params' });
        }
        return await this.handlers.applyFix(params as FixRequest);
      }
      case 'health': {
        const s = this.handlers.getStatus();
        const out: HealthOut = {
          ok: true,
          status: s.status,
          workerId: this.workerId,
          currentStoryId: s.currentStoryId,
          uptimeMs: this.now() - this.startedAt,
        };
        return out;
      }
      case 'flush_logs': {
        const lines = this.handlers.flushLogs();
        const out: FlushLogsOut = { lines };
        return out;
      }
      case 'shutdown': {
        if (this.shuttingDown) {
          throw Object.assign(new Error('already shutting down'), { code: 'already-shutting-down' });
        }
        this.shuttingDown = true;
        // Don't await: the handler likely closes the server itself. We
        // resolve immediately so the response can be written first.
        void this.handlers.shutdown();
        const out: ShutdownOut = { graceful: true };
        return out;
      }
      default:
        throw Object.assign(new Error(`unknown method: ${req.method}`), { code: 'unknown-method' });
    }
  }

  private write(socket: net.Socket, response: IpcResponse): void {
    try {
      socket.write(`${JSON.stringify(response)}\n`);
    } catch {
      // ignore — client may have hung up
    }
  }
}

// ─── Tiny client (used by Fix-It Agent + tests) ──────────────────────────────

/**
 * Minimal client for one-shot RPC calls. Opens a fresh connection per
 * call so the caller doesn't need to manage state. The Fix-It Agent
 * uses this in its retest loop.
 */
export async function ipcCall<T = unknown>(
  socketPath: string,
  method: string,
  params?: Record<string, unknown>,
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  return await new Promise<T>((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let buffer = '';
    let settled = false;
    const id = `rpc_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const cleanup = () => {
      try { socket.end(); } catch {}
    };
    const onTimeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`ipc timeout after ${timeoutMs}ms calling ${method}`));
    }, timeoutMs);
    onTimeout.unref?.();
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ id, method, params: params ?? {} })}\n`);
    });
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      const line = buffer.slice(0, nl);
      try {
        const resp: IpcResponse = JSON.parse(line);
        clearTimeout(onTimeout);
        if (settled) return;
        settled = true;
        cleanup();
        if (resp.ok) {
          resolve(resp.result as T);
        } else {
          const e = new Error(resp.error.message) as Error & { code?: string };
          e.code = resp.error.code;
          reject(e);
        }
      } catch (e) {
        if (settled) return;
        settled = true;
        clearTimeout(onTimeout);
        cleanup();
        reject(e as Error);
      }
    });
    socket.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(onTimeout);
      reject(err);
    });
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(onTimeout);
      reject(new Error(`ipc connection closed before response (method=${method})`));
    });
  });
}

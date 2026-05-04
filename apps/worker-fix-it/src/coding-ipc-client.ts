/**
 * `CodingIpcClient` — FIX-005 (Phase 2D).
 *
 * The Coding Agent's IPC server lands in CODING-007 (parallel track).
 * This file ships:
 *
 *   - The wire-format definition (newline-delimited JSON over a
 *     Unix-domain socket at `~/.caia/sockets/<workerId>.sock`).
 *   - `UnixSocketCodingIpcClient` — the real client implementation,
 *     ready to plug in once CODING-007 merges.
 *   - `MemoryCodingIpcInvoker` — an in-process mock that conforms to
 *     the same `CodingIpcInvoker` interface; this is what
 *     `bootstrap()` uses today, until the real server is available.
 *   - `socketPathForWorker()` and `UnixSocketCodingIpcClient.fromEnv()`
 *     conveniences so the swap from memory → unix socket is a
 *     one-line config change.
 *
 * Wire format (line-delimited JSON, request → response):
 *
 *     { "id": "abc", "method": "apply_fix", "params": { ... } }\n
 *     { "id": "abc", "ok": true, "result": { ... } }\n
 *
 * Methods (per the architecture spec):
 *
 *     apply_fix    → { ok: boolean, sha?, summary?, error? }
 *     health       → { ok: true, sessionUptimeS, lastSdkResponseAgeS }
 *     flush_logs   → { logs: string[] }
 *     close_session → { ok: true }   // server tears down its session
 *
 * @owner fix-it-test-agent (Phase 2D worker track)
 */

import { connect, Socket } from 'net';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import type { CodingIpcInvoker, FixOutcome } from './stubs';
import type { FixRequest } from './types';

// ─── Wire format ────────────────────────────────────────────────────────────

export type IpcMethod = 'apply_fix' | 'health' | 'flush_logs' | 'close_session';

export interface IpcRequest<P = unknown> {
  id: string;
  method: IpcMethod;
  params?: P;
}

export interface IpcResponse<R = unknown> {
  id: string;
  ok: boolean;
  result?: R;
  error?: string;
}

export interface HealthResult {
  ok: true;
  sessionUptimeS: number;
  lastSdkResponseAgeS: number;
}

export interface FlushLogsResult {
  logs: string[];
}

// ─── Path conventions ───────────────────────────────────────────────────────

// IDs become a filename component; reject anything outside the safe charset
// to prevent traversal via the `workerId` argument.
const SAFE_WORKER_ID = /^[A-Za-z0-9._-]+$/;

export function socketPathForWorker(workerId: string, base?: string): string {
  if (!SAFE_WORKER_ID.test(workerId) || workerId === '.' || workerId === '..') {
    throw new Error(
      `[fix-it] refusing to build socket path: workerId ${JSON.stringify(workerId)} contains unsafe characters`,
    );
  }
  // base is operator-controlled (env-supplied or computed from homedir);
  // workerId has been validated above as a flat alphanum-dot-dash-underscore.
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal
  return join(base ?? join(homedir(), '.caia', 'sockets'), `${workerId}.sock`);
}

// ─── In-memory invoker (used until CODING-007 ships) ────────────────────────

export interface MemoryCodingIpcInvokerOptions {
  alwaysFix?: boolean;
  respond?: (req: FixRequest) => Promise<FixOutcome> | FixOutcome;
}

export class MemoryCodingIpcInvoker implements CodingIpcInvoker {
  public readonly calls: FixRequest[] = [];
  public closeSessionCalls = 0;

  constructor(private readonly opts: MemoryCodingIpcInvokerOptions = {}) {}

  async applyFix(req: FixRequest): Promise<FixOutcome> {
    this.calls.push(req);
    if (this.opts.respond) {
      const out = await this.opts.respond(req);
      return out;
    }
    if (this.opts.alwaysFix === false) {
      return { ok: false, error: 'memory-invoker: alwaysFix=false' };
    }
    return {
      ok: true,
      sha: `mem${this.calls.length.toString(16).padStart(7, '0')}`,
      summary: `memory invoker fix #${this.calls.length} for ${req.testCaseId}`,
    };
  }

  async shutdown(): Promise<void> {
    this.closeSessionCalls += 1;
  }
}

// ─── Real Unix-domain socket client ─────────────────────────────────────────

export interface UnixSocketCodingIpcClientOptions {
  socketPath: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_REQUEST_TIMEOUT_MS = 120_000;

export class UnixSocketCodingIpcClient implements CodingIpcInvoker {
  private socket: Socket | null = null;
  private connecting: Promise<Socket> | null = null;
  private buffer = '';
  private readonly pending = new Map<
    string,
    { resolve: (resp: IpcResponse) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private readonly opts: UnixSocketCodingIpcClientOptions) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): UnixSocketCodingIpcClient | null {
    const explicit = env.CODING_IPC_SOCKET;
    if (explicit && existsSync(explicit)) {
      return new UnixSocketCodingIpcClient({ socketPath: explicit });
    }
    const workerId = env.CODING_WORKER_ID;
    if (workerId) {
      const path = socketPathForWorker(workerId);
      if (existsSync(path)) {
        return new UnixSocketCodingIpcClient({ socketPath: path });
      }
    }
    return null;
  }

  async applyFix(req: FixRequest): Promise<FixOutcome> {
    try {
      const resp = await this.send<{ sha?: string; summary?: string }>('apply_fix', req);
      if (!resp.ok) {
        return { ok: false, error: resp.error ?? 'unknown error' };
      }
      const r = resp.result ?? {};
      return { ok: true, sha: r.sha, summary: r.summary };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async health(): Promise<HealthResult> {
    const resp = await this.send<HealthResult>('health');
    if (!resp.ok || !resp.result) {
      throw new Error(resp.error ?? 'health request failed');
    }
    return resp.result;
  }

  async flushLogs(): Promise<string[]> {
    const resp = await this.send<FlushLogsResult>('flush_logs');
    if (!resp.ok || !resp.result) return [];
    return resp.result.logs ?? [];
  }

  async shutdown(): Promise<void> {
    try {
      await this.send('close_session');
    } catch {
      // best-effort — server might close the socket on us
    } finally {
      this.close();
    }
  }

  // ─── private ──────────────────────────────────────────────────────────────

  private async send<R>(
    method: IpcMethod,
    params?: unknown,
  ): Promise<IpcResponse<R>> {
    const sock = await this.ensureConnected();
    const id = randomUUID();
    const req: IpcRequest = { id, method, params };

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`ipc-timeout: ${method} after ${this.requestTimeoutMs()}ms`));
      }, this.requestTimeoutMs());

      this.pending.set(id, {
        resolve: resolve as (r: IpcResponse) => void,
        reject,
        timer,
      });

      sock.write(`${JSON.stringify(req)}\n`, (err) => {
        if (err) {
          this.pending.delete(id);
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }

  private async ensureConnected(): Promise<Socket> {
    if (this.socket && !this.socket.destroyed) return this.socket;
    if (this.connecting) return this.connecting;

    this.connecting = new Promise((resolve, reject) => {
      const sock = connect(this.opts.socketPath);
      const timeout = this.opts.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error(`ipc-connect-timeout: ${this.opts.socketPath} after ${timeout}ms`));
      }, timeout);

      sock.once('connect', () => {
        clearTimeout(timer);
        this.socket = sock;
        sock.on('data', (b) => this.onData(b));
        sock.on('close', () => this.onClose());
        sock.on('error', (err) => this.onError(err));
        resolve(sock);
      });
      sock.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      if (!line.trim()) continue;
      this.handleLine(line);
    }
  }

  private handleLine(line: string): void {
    let parsed: IpcResponse;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!parsed.id || typeof parsed.ok !== 'boolean') return;
    const entry = this.pending.get(parsed.id);
    if (!entry) return;
    this.pending.delete(parsed.id);
    clearTimeout(entry.timer);
    entry.resolve(parsed);
  }

  private onClose(): void {
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(new Error('ipc-socket-closed'));
      this.pending.delete(id);
    }
    this.socket = null;
  }

  private onError(err: Error): void {
    for (const [id, { reject, timer }] of this.pending) {
      clearTimeout(timer);
      reject(err);
      this.pending.delete(id);
    }
  }

  private close(): void {
    if (this.socket && !this.socket.destroyed) {
      this.socket.end();
      this.socket.destroy();
    }
    this.socket = null;
  }

  private requestTimeoutMs(): number {
    return this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }
}

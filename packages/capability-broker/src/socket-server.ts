/**
 * Unix-domain-socket server hosting the in-process HookControlledMode
 * for Claude Code's `--hook-pre-tool-use` / `--hook-post-tool-use` hooks.
 *
 * The hook subprocess (`bin/broker-hook.ts`) is a small stdio shim that
 * forwards Claude Code's JSON frame to this server over a UDS, and pipes
 * the JSON decision back to stdout. This keeps the broker's policy state
 * (registry, ledger, in-flight tokens) in a single in-process owner, and
 * lets multiple per-task hook subprocesses share that state.
 *
 * Reference: caia/docs/capability-broker.md §"Hook-controlled mode",
 * v2 §3.8.
 */

import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Server, Socket } from 'node:net';
import type {
  HookControlledMode,
  HookPreToolUseInput,
  HookPostToolUseInput,
} from './hook-controlled.js';

export interface BrokerSocketServerOptions {
  /** Absolute UDS path. Parent dir is created. Existing socket is unlinked. */
  socketPath: string;
  /** The in-process broker hook adapter. */
  hook: HookControlledMode;
  /** Per-frame deadline, milliseconds. Default 5000. */
  perFrameTimeoutMs?: number;
  /** Optional logger; default no-op. */
  log?: (
    ev:
      | { kind: 'listen'; socketPath: string }
      | { kind: 'frame'; op: 'preToolUse' | 'postToolUse'; ms: number; decision?: string }
      | { kind: 'frame-error'; message: string }
      | { kind: 'parse-error'; message: string }
      | { kind: 'closed' },
  ) => void;
}

/** JSON frame on the wire — line-delimited; one frame per request. */
export interface BrokerWireFrame {
  op: 'preToolUse' | 'postToolUse';
  payload: HookPreToolUseInput | HookPostToolUseInput;
}

export class BrokerSocketServer {
  private readonly opts: BrokerSocketServerOptions;
  private server: Server | null = null;

  constructor(opts: BrokerSocketServerOptions) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    const sockPath = this.opts.socketPath;
    fs.mkdirSync(path.dirname(sockPath), { recursive: true });
    if (fs.existsSync(sockPath)) {
      try { fs.unlinkSync(sockPath); } catch { /* race with another listener */ }
    }
    return new Promise<void>((resolve, reject) => {
      const server = net.createServer((sock) => this.handleConnection(sock));
      server.on('error', (err) => reject(err));
      server.listen(sockPath, () => {
        this.server = server;
        try { fs.chmodSync(sockPath, 0o600); } catch { /* best effort */ }
        this.opts.log?.({ kind: 'listen', socketPath: sockPath });
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const s = this.server;
    if (!s) return;
    await new Promise<void>((r) => s.close(() => r()));
    this.server = null;
    try { fs.unlinkSync(this.opts.socketPath); } catch { /* gone */ }
    this.opts.log?.({ kind: 'closed' });
  }

  private handleConnection(sock: Socket): void {
    let buf = '';
    const timeoutMs = this.opts.perFrameTimeoutMs ?? 5000;
    const deadline = setTimeout(() => {
      try {
        sock.write(JSON.stringify({ decision: 'deny', reason: 'broker-socket: per-frame timeout' }) + '\n');
      } catch { /* socket already gone */ }
      sock.destroy(new Error('broker-socket: per-frame timeout'));
    }, timeoutMs);
    sock.on('data', (chunk: Buffer) => {
      buf += chunk.toString('utf8');
      let idx: number;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        const t0 = Date.now();
        let decision: string | undefined;
        let opForLog: 'preToolUse' | 'postToolUse' = 'preToolUse';
        try {
          const frame = JSON.parse(line) as BrokerWireFrame;
          opForLog = frame.op;
          if (frame.op === 'preToolUse') {
            const out = this.opts.hook.preToolUse(frame.payload as HookPreToolUseInput);
            decision = out.decision;
            sock.write(JSON.stringify(out) + '\n');
          } else if (frame.op === 'postToolUse') {
            const out = this.opts.hook.postToolUse(frame.payload as HookPostToolUseInput);
            sock.write(JSON.stringify(out) + '\n');
          } else {
            const op = (frame as { op: string }).op;
            this.opts.log?.({ kind: 'parse-error', message: `unknown op '${op}'` });
            sock.write(JSON.stringify({ decision: 'deny', reason: `broker-socket: unknown op` }) + '\n');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.opts.log?.({ kind: 'frame-error', message });
          sock.write(JSON.stringify({ decision: 'deny', reason: `broker-socket: ${message}` }) + '\n');
        }
        const ms = Date.now() - t0;
        if (decision !== undefined) {
          this.opts.log?.({ kind: 'frame', op: opForLog, ms, decision });
        } else {
          this.opts.log?.({ kind: 'frame', op: opForLog, ms });
        }
      }
    });
    sock.on('close', () => {
      clearTimeout(deadline);
    });
    sock.on('error', (err) => {
      clearTimeout(deadline);
      this.opts.log?.({ kind: 'frame-error', message: err.message });
    });
  }
}

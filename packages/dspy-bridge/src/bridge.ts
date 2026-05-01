/**
 * Node-side bridge. Spawns a `uv`-pinned Python sub-process that hosts
 * the DSPy programs and exposes typed RPC over JSON-Lines.
 *
 * Lifecycle:
 *
 *   const bridge = new DspyBridge();
 *   await bridge.start();
 *   const r = await bridge.predict({ program, version, input });
 *   await bridge.stop();
 *
 * Concurrency model: one in-flight request per bridge. If the caller
 * needs more, instantiate a pool. (DSPy module forward calls aren't
 * inherently single-threaded, but the Python server we ship is a
 * single-threaded JSON-line loop — keeping it boring.)
 *
 * Hard constraints (Prakash 2026-04-30):
 *   - never spawns Claude with an API key (Python side mirrors the rule)
 *   - never installs Python deps into system Python (always `uv run`)
 *   - sub-process inherits NO env vars by default — only PATH and
 *     OLLAMA_HOST get forwarded
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface, type Interface as ReadlineInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import * as fs from 'node:fs';

import type {
  CompileParams,
  CompileResult,
  DspyMethod,
  DspyRequest,
  DspyResponse,
  ListProgramsResult,
  LoadProgramParams,
  LoadProgramResult,
  PingResult,
  PredictParams,
  PredictResult,
} from './protocol.js';

export class DspyBridgeError extends Error {
  public readonly code: string;
  public readonly detail: unknown;

  constructor(code: string, message: string, detail?: unknown) {
    super(`[dspy-bridge] ${code}: ${message}`);
    this.name = 'DspyBridgeError';
    this.code = code;
    this.detail = detail;
  }
}

export interface DspyBridgeOptions {
  /**
   * Override path to the Python directory (`packages/dspy-bridge/python`).
   * Default resolves relative to the compiled `dist/` location.
   */
  pythonDir?: string;
  /**
   * Override the Ollama host the Python LM adapter dials.
   * Default: http://127.0.0.1:11434.
   */
  ollamaHost?: string;
  /**
   * Per-call timeout in ms. Default 60_000 (1 min — predicts are fast,
   * compiles route through `compile()` which has its own longer timeout).
   */
  defaultTimeoutMs?: number;
  /**
   * Optional override for the `uv` binary. Default: 'uv' (PATH lookup).
   */
  uvBin?: string;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: DspyMethod;
  startedMs: number;
  timeoutId: NodeJS.Timeout;
}

export class DspyBridge {
  private readonly opts: Required<DspyBridgeOptions>;
  private proc: ChildProcessWithoutNullStreams | null = null;
  private rl: ReadlineInterface | null = null;
  private readonly pending = new Map<string, PendingCall>();
  private startPromise: Promise<void> | null = null;

  constructor(options: DspyBridgeOptions = {}) {
    this.opts = {
      pythonDir: options.pythonDir ?? this.resolveDefaultPythonDir(),
      ollamaHost: options.ollamaHost ?? 'http://127.0.0.1:11434',
      defaultTimeoutMs: options.defaultTimeoutMs ?? 60_000,
      uvBin: options.uvBin ?? 'uv',
    };
  }

  /**
   * Spawn the Python sub-process. Idempotent — repeated calls return
   * the same start promise.
   */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    if (!fs.existsSync(this.opts.pythonDir)) {
      throw new DspyBridgeError(
        'no-python-dir',
        `Python dir not found: ${this.opts.pythonDir}. ` +
          `Did you run \`pnpm --filter @chiefaia/dspy-bridge run py:bootstrap\`?`,
      );
    }

    // `uv run --directory <pythonDir> python -m caia_dspy_bridge.server`
    // gives us a fully-isolated env without polluting system Python.
    const args = [
      'run',
      '--directory',
      this.opts.pythonDir,
      'python',
      '-m',
      'caia_dspy_bridge.server',
    ];

    const env: NodeJS.ProcessEnv = {
      // Restrict env: only PATH (so `uv` resolves) + OLLAMA_HOST (so the
      // LM adapter dials the right loopback). NEVER forward
      // ANTHROPIC_API_KEY — the binary subscription path is the only
      // sanctioned Claude path in CAIA.
      PATH: process.env.PATH ?? '',
      OLLAMA_HOST: this.opts.ollamaHost,
      // Tell DSPy to be quiet; keep stderr useful.
      DSP_CACHEDIR: path.join(this.opts.pythonDir, '.dspy-cache'),
    };

    const proc = spawn(this.opts.uvBin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });

    proc.on('error', (err) => {
      const wrapped = new DspyBridgeError('spawn-failed', err.message, err);
      this.failAllPending(wrapped);
    });

    proc.on('exit', (code, signal) => {
      const reason = `python sub-process exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`;
      this.failAllPending(new DspyBridgeError('proc-exited', reason));
      this.proc = null;
      this.rl = null;
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      // Pass-through. Server prints structured logs there.
      process.stderr.write(`[dspy-bridge:py] ${chunk.toString('utf8')}`);
    });

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on('line', (line) => this.onLine(line));

    this.proc = proc;
    this.rl = rl;

    // Confirm the child is alive with a ping.
    await this.call<PingResult>('ping', { payload: 'hello' });
  }

  /**
   * Stop the sub-process. Idempotent.
   */
  async stop(): Promise<void> {
    const proc = this.proc;
    if (!proc) return;

    // Best-effort graceful shutdown — fire shutdown then wait for exit.
    try {
      await this.callWithTimeout('shutdown', {}, 2_000);
    } catch {
      // Ignore — the child may have died already.
    }

    return await new Promise<void>((resolve) => {
      const onExit = (): void => {
        proc.off('exit', onExit);
        resolve();
      };
      if (proc.exitCode !== null) {
        resolve();
        return;
      }
      proc.on('exit', onExit);
      // SIGTERM, then SIGKILL if it doesn't go quietly.
      try {
        proc.kill('SIGTERM');
      } catch {
        // already dead
      }
      setTimeout(() => {
        if (proc.exitCode === null) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // best effort
          }
        }
      }, 2_000).unref();
    });
  }

  // ─── Typed RPCs ────────────────────────────────────────────────────────

  ping(): Promise<PingResult> {
    return this.call<PingResult>('ping', { payload: 'ping' });
  }

  loadProgram(params: LoadProgramParams): Promise<LoadProgramResult> {
    return this.call<LoadProgramResult>('load_program', params);
  }

  predict(params: PredictParams): Promise<PredictResult> {
    return this.call<PredictResult>('predict', params);
  }

  compile(params: CompileParams): Promise<CompileResult> {
    // Compiles can be slow (MIPROv2 + eval). Default 30 min.
    return this.callWithTimeout<CompileResult>('compile', params, 30 * 60_000);
  }

  listPrograms(): Promise<ListProgramsResult> {
    return this.call<ListProgramsResult>('list_programs', {});
  }

  // ─── Internals ─────────────────────────────────────────────────────────

  private async call<T>(method: DspyMethod, params: unknown): Promise<T> {
    return await this.callWithTimeout<T>(method, params, this.opts.defaultTimeoutMs);
  }

  private async callWithTimeout<T>(
    method: DspyMethod,
    params: unknown,
    timeoutMs: number,
  ): Promise<T> {
    if (!this.proc || !this.proc.stdin.writable) {
      throw new DspyBridgeError('not-started', 'bridge is not running; call start() first');
    }
    const id = randomUUID();
    const req: DspyRequest = { id, method, params };
    const line = `${JSON.stringify(req)}\n`;

    return await new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new DspyBridgeError(
            'timeout',
            `method "${method}" exceeded ${String(timeoutMs)} ms`,
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        method,
        startedMs: Date.now(),
        timeoutId,
      });

      const ok = this.proc?.stdin.write(line);
      if (ok === false) {
        // backpressure — wait for drain.
        this.proc?.stdin.once('drain', () => {
          /* noop — already enqueued */
        });
      }
    });
  }

  private onLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let resp: DspyResponse;
    try {
      resp = JSON.parse(trimmed) as DspyResponse;
    } catch (err) {
      // The Python server is supposed to emit pure JSONL on stdout. If
      // we got non-JSON, treat as a fatal protocol break.
      this.failAllPending(
        new DspyBridgeError('protocol-break', `non-JSON line on stdout: ${trimmed.slice(0, 200)}`),
      );
      return;
    }
    const pending = this.pending.get(resp.id);
    if (!pending) {
      // Unknown id — server shouldn't do this. Log and drop.
      process.stderr.write(`[dspy-bridge] dropped response with unknown id ${resp.id}\n`);
      return;
    }
    this.pending.delete(resp.id);
    clearTimeout(pending.timeoutId);
    if (resp.ok) {
      pending.resolve(resp.result);
    } else {
      pending.reject(new DspyBridgeError(resp.error.code, resp.error.message, resp.error.detail));
    }
  }

  private failAllPending(err: Error): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timeoutId);
      p.reject(err);
    }
    this.pending.clear();
  }

  private resolveDefaultPythonDir(): string {
    // dist/bridge.js → ../python
    return path.resolve(__dirname, '..', 'python');
  }
}

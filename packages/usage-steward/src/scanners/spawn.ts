/**
 * Shared scanner-spawn helpers.
 *
 * Every scanner wrapper does the same dance:
 *   1. probe the binary via `which`
 *   2. spawn it with scanner-specific args
 *   3. capture stdout/stderr with a size cap (forensic tail)
 *   4. apply a per-run timeout
 *   5. surface clean error rows instead of throwing
 *
 * Centralising the dance keeps each scanner module small and uniform.
 */

import { spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import type { ScannerToolingState } from '../types.js';

const execFileAsync = promisify(execFile);

const STDOUT_CAP = 4 * 1024 * 1024; // 4 MB hard cap on captured stdout
const STDERR_CAP = 512 * 1024; // 512 KB hard cap on captured stderr
export const TAIL_BYTES = 4 * 1024; // last 4 KB of each stream for forensic surface

export interface ProbeResult {
  readonly state: ScannerToolingState;
  readonly binaryPath?: string;
  readonly version?: string;
  readonly errorMessage?: string;
}

/**
 * Resolve a binary on $PATH. Tries:
 *   1. `which <bin>`
 *   2. `npx --no-install -p <pkg> <bin> --version` as a fallback
 *
 * The second hop catches the common case where the scanner is
 * installed locally to the monorepo via pnpm but not exposed on the
 * user's global $PATH. We never `npm install` from the steward — only
 * use what's already resolvable.
 */
export async function probeBinary(
  bin: string,
  versionArgs: ReadonlyArray<string> = ['--version'],
): Promise<ProbeResult> {
  // Step 1: which
  try {
    const which = await execFileAsync('which', [bin], { timeout: 2000 });
    const binaryPath = which.stdout.trim();
    if (binaryPath !== '') {
      const version = await tryVersion(binaryPath, versionArgs);
      return { state: 'present', binaryPath, ...(version !== undefined ? { version } : {}) };
    }
  } catch {
    /* fall through */
  }
  // Step 2: npx --no-install fallback. Only useful when run inside the monorepo.
  try {
    const npx = await execFileAsync(
      'npx',
      ['--no-install', bin, ...versionArgs],
      { timeout: 4000 },
    );
    const version = npx.stdout.trim().split('\n')[0];
    return { state: 'present', binaryPath: `npx:${bin}`, ...(version !== undefined && version !== '' ? { version } : {}) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/not found|ENOENT/.test(msg)) {
      return { state: 'absent', errorMessage: `binary ${bin} not on PATH` };
    }
    return { state: 'absent', errorMessage: msg };
  }
}

async function tryVersion(
  binaryPath: string,
  versionArgs: ReadonlyArray<string>,
): Promise<string | undefined> {
  try {
    const out = await execFileAsync(binaryPath, [...versionArgs], { timeout: 4000 });
    const v = (out.stdout || out.stderr || '').trim().split('\n')[0];
    return v === '' ? undefined : v;
  } catch {
    return undefined;
  }
}

export interface SpawnOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  /** Extra env to merge into the child env. */
  readonly env?: Readonly<Record<string, string>>;
}

export interface SpawnResult {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly durationMs: number;
  /** True iff the process couldn't even be launched (ENOENT). */
  readonly notFound: boolean;
}

/**
 * Spawn a binary, collect stdout + stderr up to caps, apply a timeout.
 * Never throws — every failure mode is encoded in the return value.
 */
export async function runBinary(
  bin: string,
  args: ReadonlyArray<string>,
  opts: SpawnOptions,
): Promise<SpawnResult> {
  const startedAt = Date.now();
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const env = { ...process.env, ...(opts.env ?? {}) };

  return await new Promise<SpawnResult>((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(bin, [...args], { cwd: opts.cwd, env });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const notFound = /ENOENT/.test(msg);
      resolve({
        exitCode: null,
        signal: null,
        stdout: '',
        stderr: msg,
        timedOut: false,
        durationMs: Date.now() - startedAt,
        notFound,
      });
      return;
    }

    let outBuf = '';
    let errBuf = '';
    let outBytes = 0;
    let errBytes = 0;
    let outTruncated = false;
    let errTruncated = false;
    let timedOut = false;
    let killed = false;
    let notFound = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killed = true;
      try {
        child.kill('SIGKILL');
      } catch {
        /* ignore */
      }
    }, timeoutMs);

    const abortHandler = (): void => {
      killed = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    };
    if (opts.signal) opts.signal.addEventListener('abort', abortHandler);

    child.stdout?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      outBytes += chunk.length;
      if (outBytes > STDOUT_CAP) {
        if (!outTruncated) {
          outBuf += s.slice(0, Math.max(0, STDOUT_CAP - (outBytes - chunk.length)));
        }
        outTruncated = true;
        return;
      }
      outBuf += s;
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      const s = chunk.toString('utf8');
      errBytes += chunk.length;
      if (errBytes > STDERR_CAP) {
        if (!errTruncated) {
          errBuf += s.slice(0, Math.max(0, STDERR_CAP - (errBytes - chunk.length)));
        }
        errTruncated = true;
        return;
      }
      errBuf += s;
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') notFound = true;
      errBuf += err.message;
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (opts.signal) opts.signal.removeEventListener('abort', abortHandler);
      resolve({
        exitCode: code,
        signal: killed ? signal ?? null : signal ?? null,
        stdout: outBuf,
        stderr: errBuf,
        timedOut,
        durationMs: Date.now() - startedAt,
        notFound,
      });
    });
  });
}

/** Take the trailing `n` bytes of a string, with a leading marker if truncated. */
export function tail(s: string, n: number = TAIL_BYTES): string {
  if (s.length <= n) return s;
  return `…[truncated ${s.length - n} bytes]…\n` + s.slice(s.length - n);
}

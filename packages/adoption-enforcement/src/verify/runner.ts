import { spawn } from 'node:child_process';
import { STDOUT_TAIL_LIMIT } from './types.js';

export interface SpawnRunResult {
  exitCode: number | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  timedOut: boolean;
}

export interface SpawnRunOptions {
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

/**
 * Spawn a command, capture tails of stdout/stderr, enforce a wall-clock timeout.
 * No shell interpolation — args are passed as an argv array.
 */
export async function runCommand(
  command: string,
  args: readonly string[],
  options: SpawnRunOptions,
): Promise<SpawnRunResult> {
  const started = Date.now();
  return await new Promise<SpawnRunResult>((resolve) => {
    const child = spawn(command, args.slice(), {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdoutBuf = '';
    let stderrBuf = '';
    let timedOut = false;

    const appendTail = (existing: string, chunk: string): string => {
      const combined = existing + chunk;
      if (combined.length <= STDOUT_TAIL_LIMIT) return combined;
      return combined.slice(combined.length - STDOUT_TAIL_LIMIT);
    };

    child.stdout?.on('data', (data: Buffer) => {
      stdoutBuf = appendTail(stdoutBuf, data.toString('utf8'));
    });
    child.stderr?.on('data', (data: Buffer) => {
      stderrBuf = appendTail(stderrBuf, data.toString('utf8'));
    });

    let killTimer: NodeJS.Timeout | undefined;
    if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
      killTimer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, options.timeoutMs);
    }

    child.on('error', (err) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: null,
        durationMs: Date.now() - started,
        stdoutTail: stdoutBuf,
        stderrTail: appendTail(stderrBuf, `\n[spawn error] ${err.message}`),
        timedOut,
      });
    });

    child.on('close', (code) => {
      if (killTimer) clearTimeout(killTimer);
      resolve({
        exitCode: code,
        durationMs: Date.now() - started,
        stdoutTail: stdoutBuf,
        stderrTail: stderrBuf,
        timedOut,
      });
    });
  });
}

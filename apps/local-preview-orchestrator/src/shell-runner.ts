/**
 * Shell-runner abstraction.
 *
 * Provides an injectable interface for executing shell commands so that the
 * deploy pipeline can be unit-tested without spawning real processes.
 *
 * Trust boundary: all command strings consumed by this module originate from
 * the compile-time SITES registry in sites-config.ts (buildCmd / startCmd) or
 * from hard-coded git operations in deploy.ts (e.g. `git fetch origin`).
 * No user-controllable input reaches a shell here. The `nosemgrep` annotations
 * below acknowledge semgrep's child-process pattern while documenting the
 * trust boundary explicitly.
 */

import { spawn } from 'node:child_process';

export interface ShellResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface ShellRunOptions {
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

export type ShellRunner = (cmd: string, opts: ShellRunOptions) => Promise<ShellResult>;

/**
 * Default shell runner — executes via /bin/bash -c.
 * Captures stdout + stderr; enforces an optional timeout via SIGKILL.
 */
export const defaultShellRunner: ShellRunner = (cmd, opts) =>
  new Promise<ShellResult>((resolve, reject) => {
    const startedAt = Date.now();
    // nosemgrep: javascript.lang.security.audit.detect-child-process.detect-child-process -- cmd originates from compile-time SITES registry or hard-coded git ops; trust boundary documented in module header
    const child = spawn('/bin/bash', ['-c', cmd], {
      cwd: opts.cwd,
      env: { ...process.env, ...(opts.env ?? {}) } as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString('utf-8');
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString('utf-8');
    });

    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, opts.timeoutMs);
    }

    child.on('error', (err) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      reject(err);
    });

    child.on('close', (code) => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const durationMs = Date.now() - startedAt;
      const exitCode = timedOut ? 124 : code ?? 0;
      resolve({
        code: exitCode,
        stdout,
        stderr: timedOut ? `${stderr}\n[killed: timeout after ${opts.timeoutMs}ms]` : stderr,
        durationMs
      });
    });
  });

/**
 * Convenience: run a command and throw if exit code is non-zero.
 * Useful for git plumbing where we expect success.
 */
export async function runOrThrow(
  runner: ShellRunner,
  cmd: string,
  opts: ShellRunOptions
): Promise<ShellResult> {
  const result = await runner(cmd, opts);
  if (result.code !== 0) {
    throw new Error(
      `Shell command failed (exit ${result.code}): ${cmd}\n` +
        `stderr: ${result.stderr.slice(0, 4000)}`
    );
  }
  return result;
}

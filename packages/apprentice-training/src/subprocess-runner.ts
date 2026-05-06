/**
 * Real subprocess runner — wraps node:child_process.spawn. Streams stdout
 * + stderr to a log file, enforces timeout, captures last 100 lines for
 * triage on error.
 *
 * Tests inject a fake `SubprocessRunner` instead of using this; this
 * module is exercised only by the integration test (Stage 6) and the
 * E2E live verify (Stage 8).
 */

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import type { SubprocessArgs, SubprocessResult, SubprocessRunner } from './types.js';

const TAIL_LINES = 100;

export const defaultSubprocessRunner: SubprocessRunner = {
  async run(input: SubprocessArgs): Promise<SubprocessResult> {
    const startMs = Date.now();
    const recentLines: string[] = [];

    const logStream =
      input.logFilePath === '/dev/null'
        ? null
        : fs.createWriteStream(input.logFilePath, { flags: 'a' });

    return new Promise<SubprocessResult>((resolve, reject) => {
      let timedOut = false;
      let killTimer: NodeJS.Timeout | null = null;

      const child = spawn(input.command, input.args, {
        cwd: input.cwd,
        env: input.env as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const captureLine = (chunk: Buffer | string): void => {
        const text = chunk.toString('utf-8');
        if (logStream) logStream.write(text);
        for (const line of text.split('\n')) {
          if (line === '') continue;
          recentLines.push(line);
          if (recentLines.length > TAIL_LINES) recentLines.shift();
        }
      };

      child.stdout?.on('data', captureLine);
      child.stderr?.on('data', captureLine);

      const timeoutHandle = setTimeout(() => {
        timedOut = true;
        if (!child.killed) {
          child.kill('SIGTERM');
          killTimer = setTimeout(() => {
            if (!child.killed) child.kill('SIGKILL');
          }, 30_000);
        }
      }, input.timeoutMs);

      child.on('error', err => {
        clearTimeout(timeoutHandle);
        if (killTimer) clearTimeout(killTimer);
        if (logStream) logStream.end();
        reject(err);
      });

      child.on('close', (code, signal) => {
        clearTimeout(timeoutHandle);
        if (killTimer) clearTimeout(killTimer);
        if (logStream) logStream.end();
        const elapsedMs = Date.now() - startMs;
        resolve({
          exitCode: code ?? -1,
          signal: signal ?? null,
          elapsedMs,
          logTail: recentLines.join('\n'),
          timedOut
        });
      });
    });
  }
};

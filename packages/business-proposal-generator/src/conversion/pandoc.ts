/**
 * Pandoc subprocess wrapper.
 *
 * The package SHELLS OUT to pandoc per the `pdf` + `docx` skills'
 * recommendations. No silent fallback to text-only — pandoc absence
 * surfaces as `PandocNotFoundError` with the install hint.
 *
 * The runner is injectable so tests can stub the subprocess without
 * needing pandoc on the test host.
 */

import { spawn } from 'node:child_process';

import { PandocError, PandocNotFoundError, ProposalGeneratorError } from '../errors.js';

export interface PandocRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Pluggable runner — production runs `pandoc`; tests inject. */
export interface PandocRunner {
  run(args: { binary: string; args: string[]; stdin?: string; cwd?: string }): Promise<PandocRunResult>;
}

/** Default runner — spawns the real binary. */
export class NodePandocRunner implements PandocRunner {
  public async run(opts: {
    binary: string;
    args: string[];
    stdin?: string;
    cwd?: string;
  }): Promise<PandocRunResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(opts.binary, opts.args, {
        cwd: opts.cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (c: Buffer) => {
        stdout += c.toString('utf8');
      });
      child.stderr.on('data', (c: Buffer) => {
        stderr += c.toString('utf8');
      });
      child.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'ENOENT') {
          reject(new PandocNotFoundError(opts.binary, err));
          return;
        }
        reject(new ProposalGeneratorError('pandoc_failed', 'failed to spawn pandoc', err));
      });
      child.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });
      if (opts.stdin !== undefined) {
        child.stdin.write(opts.stdin);
        child.stdin.end();
      } else {
        child.stdin.end();
      }
    });
  }
}

/** Run pandoc with the given args, throw PandocError on non-zero exit. */
export async function runPandoc(
  runner: PandocRunner,
  opts: { binary: string; args: string[]; stdin?: string; cwd?: string },
): Promise<PandocRunResult> {
  const r = await runner.run(opts);
  if (r.exitCode !== 0) {
    throw new PandocError({ exitCode: r.exitCode, stderr: r.stderr, stdout: r.stdout });
  }
  return r;
}

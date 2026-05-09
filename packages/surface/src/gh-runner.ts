/**
 * Default `gh` CLI runner. Tests inject a fake.
 *
 * Subscription-only: we never set ANTHROPIC_API_KEY here. The shell-out is
 * `gh`, which uses the operator's existing PAT — no per-token billing.
 */

import { spawn } from 'node:child_process';

import type { GhRunner, GitRunner } from './types.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export const defaultGhRunner: GhRunner = {
  run(args: readonly string[]): Promise<string> {
    return runShell('gh', args, undefined);
  }
};

export const defaultGitRunner: GitRunner = {
  log(repo: string, args: readonly string[]): Promise<string> {
    return runShell('git', ['-C', repo, 'log', ...args], undefined);
  }
};

function runShell(cmd: string, args: readonly string[], cwd: string | undefined): Promise<string> {
  return new Promise((resolveP, rejectP) => {
    const env = { ...process.env };
    delete env['ANTHROPIC_API_KEY'];

    const child = spawn(cmd, [...args], {
      env,
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const chunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    child.stdout.on('data', d => chunks.push(d as Buffer));
    child.stderr.on('data', d => errChunks.push(d as Buffer));

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      rejectP(new Error(`${cmd} ${args.join(' ')} timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);

    child.on('error', e => {
      clearTimeout(timer);
      rejectP(e);
    });
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        const err = Buffer.concat(errChunks).toString('utf-8').slice(0, 500);
        rejectP(new Error(`${cmd} exited ${code}: ${err}`));
        return;
      }
      resolveP(Buffer.concat(chunks).toString('utf-8'));
    });
  });
}

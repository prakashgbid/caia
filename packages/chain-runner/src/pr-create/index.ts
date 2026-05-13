// Logic for `caia-pr-create-safe`.
//
// Wraps `gh pr create`:
//   1. Enable `git config rerere.enabled true` (remember conflict resolutions).
//   2. Fetch origin/<base> (default: develop).
//   3. If current branch is BEHIND base, attempt `git rebase origin/<base>`.
//   4. On unresolvable conflicts: abort the rebase, exit 1 with clear reason.
//   5. Push with --force-with-lease, then run `gh pr create` with passthrough args.

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CreateSafeOpts {
  base?: string | undefined; // default develop
  remote?: string | undefined; // default origin
  cwd?: string | undefined; // working dir (must be a git checkout)
  ghCreateArgs: string[]; // args passed straight to `gh pr create`
  logFile?: string | undefined;
  forcePushDisabled?: boolean | undefined;
}

export type CreateSafeOutcome =
  | { kind: 'created'; output: string }
  | { kind: 'skipped'; reason: string }
  | { kind: 'failed'; reason: string };

const DEFAULT_LOG = join(
  homedir(),
  '.caia',
  'chain-runner',
  'pr-create-attempts.jsonl',
);

function nowIso(): string {
  return new Date().toISOString();
}

function logEvent(file: string, event: Record<string, unknown>): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify({ ts: nowIso(), ...event })}\n`, {
      mode: 0o600,
    });
  } catch {
    // ignore
  }
}

function run(
  cmd: string,
  args: string[],
  cwd?: string,
): { ok: boolean; code: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8', cwd, env: process.env });
  return {
    ok: (r.status ?? 1) === 0,
    code: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

export async function createSafe(
  opts: CreateSafeOpts,
): Promise<CreateSafeOutcome> {
  const base = opts.base ?? 'develop';
  const remote = opts.remote ?? 'origin';
  const cwd = opts.cwd;
  const logFile = opts.logFile ?? DEFAULT_LOG;

  // Determine current branch
  const cur = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], cwd);
  if (!cur.ok) {
    return { kind: 'failed', reason: `not in a git checkout: ${cur.stderr.trim()}` };
  }
  const branch = cur.stdout.trim();
  if (!branch || branch === 'HEAD') {
    return { kind: 'failed', reason: 'detached HEAD or no branch' };
  }
  if (branch === base) {
    return {
      kind: 'failed',
      reason: `refusing to open PR from base branch ${base}`,
    };
  }

  logEvent(logFile, {
    event: 'start',
    branch,
    base,
    cwd: cwd ?? process.cwd(),
  });

  // Enable rerere
  run('git', ['config', 'rerere.enabled', 'true'], cwd);

  // Fetch base
  const fetch = run('git', ['fetch', remote, base], cwd);
  if (!fetch.ok) {
    logEvent(logFile, { event: 'fetch.failed', err: fetch.stderr });
    return {
      kind: 'failed',
      reason: `fetch ${remote}/${base} failed: ${fetch.stderr.trim()}`,
    };
  }

  // Count commits behind
  const rev = run(
    'git',
    ['rev-list', '--count', `HEAD..${remote}/${base}`],
    cwd,
  );
  const behind = rev.ok ? Number(rev.stdout.trim() || '0') : 0;

  if (behind > 0) {
    logEvent(logFile, { event: 'rebase.start', branch, base, behind });
    const rebase = run('git', ['rebase', `${remote}/${base}`], cwd);
    if (!rebase.ok) {
      // Abort and report
      run('git', ['rebase', '--abort'], cwd);
      logEvent(logFile, {
        event: 'rebase.conflicts',
        branch,
        err: rebase.stderr.slice(0, 1000),
      });
      return {
        kind: 'failed',
        reason: `rebase onto ${remote}/${base} has unresolved conflicts; manual resolution required`,
      };
    }

    // Push with --force-with-lease
    if (!opts.forcePushDisabled) {
      const push = run(
        'git',
        ['push', '--force-with-lease', remote, branch],
        cwd,
      );
      logEvent(logFile, {
        event: 'rebase.push',
        ok: push.ok,
        err: push.stderr.slice(0, 500),
      });
      if (!push.ok) {
        return {
          kind: 'failed',
          reason: `push --force-with-lease failed: ${push.stderr.trim()}`,
        };
      }
    }
  } else {
    // Ensure branch is pushed
    const push = run('git', ['push', '-u', remote, branch], cwd);
    if (!push.ok) {
      // Branch may already be tracking — that's fine; just try plain push
      const push2 = run('git', ['push', remote, branch], cwd);
      if (!push2.ok) {
        logEvent(logFile, {
          event: 'push.failed',
          err: push2.stderr.slice(0, 500),
        });
        return {
          kind: 'failed',
          reason: `push ${branch} → ${remote} failed: ${push2.stderr.trim()}`,
        };
      }
    }
  }

  // Run gh pr create with passthrough args
  const args = ['pr', 'create', ...opts.ghCreateArgs];
  // If user didn't supply --base, force it
  if (!opts.ghCreateArgs.includes('--base')) {
    args.push('--base', base);
  }
  const create = run('gh', args, cwd);
  logEvent(logFile, {
    event: 'gh.pr.create',
    ok: create.ok,
    out: create.stdout.slice(0, 500),
    err: create.stderr.slice(0, 500),
  });
  if (!create.ok) {
    return {
      kind: 'failed',
      reason: `gh pr create failed: ${create.stderr.trim() || create.stdout.trim()}`,
    };
  }

  return { kind: 'created', output: create.stdout.trim() };
}

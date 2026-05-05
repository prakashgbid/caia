/**
 * Unit tests for deploy.ts — exercise the state machine via stubbed
 * shell-runner / git-ops / health-checker / restart-process. No real
 * subprocesses are spawned here; integration coverage lives in
 * deploy.integration.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync, readlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deploySite,
  extractShaFromBuildPath,
  resolveBuildDir,
  resolveSitePath,
  LockHeldError
} from '../src/deploy';
import type { ShellRunner, ShellResult } from '../src/shell-runner';
import type { GitOps } from '../src/git-ops';
import type { SiteConfig } from '../src/sites-config';

const SHA = '1111111111111111111111111111111111111111';
const SHA2 = '2222222222222222222222222222222222222222';

let installRoot: string;
let buildWorkspaceRoot: string;
let repoPath: string;

beforeEach(() => {
  installRoot = mkdtempSync(join(tmpdir(), 'lp-deploy-install-'));
  buildWorkspaceRoot = mkdtempSync(join(tmpdir(), 'lp-deploy-buildws-'));
  repoPath = mkdtempSync(join(tmpdir(), 'lp-deploy-repo-'));
});

afterEach(() => {
  rmSync(installRoot, { recursive: true, force: true });
  rmSync(buildWorkspaceRoot, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
});

const baseSite: SiteConfig = {
  name: 'fake-site',
  repo: '<set per test>',
  branch: 'develop',
  port: 9999,
  buildCmd: 'echo build-ok',
  startCmd: (p) => `echo start ${p}`,
  healthPath: '/',
  healthMustContain: '<title',
  buildArtifacts: ['dist']
};

const okShell = (stdout = ''): ShellResult => ({ code: 0, stdout, stderr: '', durationMs: 1 });
const failShell = (code = 1, stderr = 'oops'): ShellResult => ({ code, stdout: '', stderr, durationMs: 1 });

/**
 * Build a stub gitOps that mimics worktree-add by populating a directory
 * with a 'dist/index.html' artifact at the given workspace path.
 */
function makeStubGitOps(targetSha: string): { gitOps: GitOps; calls: string[] } {
  const calls: string[] = [];
  const gitOps: GitOps = {
    fetch: async (repo, branch) => {
      calls.push(`fetch ${repo} ${branch}`);
    },
    resolveBranchSha: async (_repo, _branch) => {
      calls.push('rev-parse');
      return targetSha;
    },
    worktreeAdd: async (_repo, target, _ref) => {
      calls.push(`worktree-add ${target}`);
      mkdirSync(join(target, 'dist'), { recursive: true });
      writeFileSync(join(target, 'dist', 'index.html'), '<html><title>ok</title></html>', 'utf-8');
    },
    worktreeRemove: async (_repo, target) => {
      calls.push(`worktree-remove ${target}`);
      rmSync(target, { recursive: true, force: true });
    }
  };
  return { gitOps, calls };
}

describe('extractShaFromBuildPath', () => {
  it('extracts SHA from a builds/<sha> string', () => {
    expect(extractShaFromBuildPath('builds/abc1234567')).toBe('abc1234567');
  });
  it('extracts SHA from absolute path', () => {
    expect(extractShaFromBuildPath('/x/y/builds/abc1234567')).toBe('abc1234567');
  });
  it('returns undefined for non-build paths', () => {
    expect(extractShaFromBuildPath('not-a-build')).toBeUndefined();
  });
});

describe('deploySite — happy path', () => {
  it('runs the pipeline end-to-end with stubbed runners', async () => {
    const { gitOps, calls } = makeStubGitOps(SHA);
    const shellRunner: ShellRunner = vi.fn(async () => okShell()) as unknown as ShellRunner;
    const restartProcess = vi.fn(async () => undefined);
    const healthChecker = vi.fn(async () => ({ ok: true, statusCode: 200, responseTime: 5 }));

    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      {
        installRoot,
        buildWorkspaceRoot,
        gitOps,
        shellRunner,
        restartProcess,
        healthChecker,
        healthCheckMaxAttempts: 1,
        healthCheckInitialDelayMs: 1
      }
    );

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.sha).toBe(SHA);
    expect(result.healthCheckMs).toBeGreaterThanOrEqual(0);
    expect(restartProcess).toHaveBeenCalledTimes(1);
    expect(healthChecker).toHaveBeenCalledTimes(1);

    // Symlink swap should have happened
    const sitePath = resolveSitePath(installRoot, baseSite.name);
    const currentLink = join(sitePath, 'current');
    expect(existsSync(currentLink)).toBe(true);
    expect(readlinkSync(currentLink)).toBe(`builds/${SHA}`);

    // Build artifact should be in place
    const installedArtifact = join(resolveBuildDir(sitePath, SHA), 'dist', 'index.html');
    expect(existsSync(installedArtifact)).toBe(true);

    // git fetch happened
    expect(calls.some((c) => c.startsWith('fetch '))).toBe(true);
    // worktree-remove happened on success
    expect(calls.some((c) => c.startsWith('worktree-remove '))).toBe(true);

    // state.json written
    const statePath = join(sitePath, 'state.json');
    expect(existsSync(statePath)).toBe(true);
  });

  it('returns noop when remote SHA matches current symlink target', async () => {
    // Pre-populate sitePath with a current symlink pointing at builds/<SHA>
    const sitePath = resolveSitePath(installRoot, baseSite.name);
    mkdirSync(sitePath, { recursive: true });
    mkdirSync(join(sitePath, 'builds', SHA), { recursive: true });
    const { symlinkSync } = await import('node:fs');
    symlinkSync(`builds/${SHA}`, join(sitePath, 'current'), 'dir');

    const { gitOps } = makeStubGitOps(SHA);
    const shellRunner: ShellRunner = vi.fn(async () => okShell()) as unknown as ShellRunner;
    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      {
        installRoot,
        buildWorkspaceRoot,
        gitOps,
        shellRunner
      }
    );

    expect(result.status).toBe('noop');
    if (result.status !== 'noop') return;
    expect(result.sha).toBe(SHA);
  });
});

describe('deploySite — failure paths', () => {
  it('returns build-failed when build command exits non-zero', async () => {
    const { gitOps } = makeStubGitOps(SHA);
    const shellRunner: ShellRunner = vi.fn(async () => failShell(1, 'compile error')) as unknown as ShellRunner;

    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      {
        installRoot,
        buildWorkspaceRoot,
        gitOps,
        shellRunner
      }
    );

    expect(result.status).toBe('build-failed');
    if (result.status !== 'build-failed') return;
    expect(result.sha).toBe(SHA);
    expect(result.error).toContain('exit 1');
    expect(result.logTail).toContain('compile error');

    // No symlink should have been created
    const sitePath = resolveSitePath(installRoot, baseSite.name);
    expect(existsSync(join(sitePath, 'current'))).toBe(false);
  });

  it('rolls back on health-check failure', async () => {
    // Pre-populate sitePath with a previous build so rollback has somewhere to go.
    const sitePath = resolveSitePath(installRoot, baseSite.name);
    mkdirSync(sitePath, { recursive: true });
    const previousSha = '0000000000000000000000000000000000000000';
    mkdirSync(join(sitePath, 'builds', previousSha), { recursive: true });
    const { symlinkSync } = await import('node:fs');
    symlinkSync(`builds/${previousSha}`, join(sitePath, 'current'), 'dir');

    const { gitOps } = makeStubGitOps(SHA2);
    const shellRunner: ShellRunner = vi.fn(async () => okShell()) as unknown as ShellRunner;
    const restartProcess = vi.fn(async () => undefined);
    const healthChecker = vi.fn(async () => ({ ok: false, error: '503 unavailable' }));

    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      {
        installRoot,
        buildWorkspaceRoot,
        gitOps,
        shellRunner,
        restartProcess,
        healthChecker,
        healthCheckMaxAttempts: 1,
        healthCheckInitialDelayMs: 1
      }
    );

    expect(result.status).toBe('health-check-failed');
    if (result.status !== 'health-check-failed') return;
    expect(result.sha).toBe(SHA2);
    expect(result.rolledBackToSha).toBe(previousSha);

    // Restart should have been invoked twice: once after swap, once after rollback
    expect(restartProcess).toHaveBeenCalledTimes(2);

    // current symlink should now point at the previous build
    const currentLink = join(sitePath, 'current');
    expect(readlinkSync(currentLink)).toBe(`builds/${previousSha}`);
  });

  it('returns rollback-failed when no previous build exists', async () => {
    // Fresh sitePath; first deploy fails health-check; nothing to roll back to.
    const { gitOps } = makeStubGitOps(SHA);
    const shellRunner: ShellRunner = vi.fn(async () => okShell()) as unknown as ShellRunner;
    const restartProcess = vi.fn(async () => undefined);
    const healthChecker = vi.fn(async () => ({ ok: false, error: '503 unavailable' }));

    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      {
        installRoot,
        buildWorkspaceRoot,
        gitOps,
        shellRunner,
        restartProcess,
        healthChecker,
        healthCheckMaxAttempts: 1,
        healthCheckInitialDelayMs: 1
      }
    );

    expect(result.status).toBe('rollback-failed');
  });

  it('returns locked when site lock is already held', async () => {
    const { gitOps } = makeStubGitOps(SHA);
    const shellRunner: ShellRunner = vi.fn(async () => okShell()) as unknown as ShellRunner;

    // Pretend lock is held
    const acquireSiteLock = (_name: string): never => {
      throw new LockHeldError('already locked');
    };

    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      {
        installRoot,
        buildWorkspaceRoot,
        gitOps,
        shellRunner,
        acquireSiteLock: acquireSiteLock as unknown as (n: string) => () => void
      }
    );

    expect(result.status).toBe('locked');
  });

  it('reports build-failed when an expected artifact is missing', async () => {
    const calls: string[] = [];
    const gitOps: GitOps = {
      fetch: async () => {
        calls.push('fetch');
      },
      resolveBranchSha: async () => SHA,
      worktreeAdd: async (_repo, target) => {
        calls.push(`worktree-add ${target}`);
        // Intentionally do NOT create the dist artifact
        mkdirSync(target, { recursive: true });
      },
      worktreeRemove: async (_repo, target) => {
        rmSync(target, { recursive: true, force: true });
      }
    };
    const shellRunner: ShellRunner = vi.fn(async () => okShell()) as unknown as ShellRunner;

    const result = await deploySite(
      { ...baseSite, repo: repoPath },
      { installRoot, buildWorkspaceRoot, gitOps, shellRunner }
    );

    expect(result.status).toBe('build-failed');
    if (result.status !== 'build-failed') return;
    expect(result.error).toContain('expected build artifact missing');
  });
});

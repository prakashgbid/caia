/**
 * Integration test for deploySite — uses a real git fixture repo + real
 * shellRunner + real gitOps. Bypasses LaunchAgent / Next.js by using a
 * trivial fake "build" command that copies files into `dist/`. The health
 * check is stubbed (unit-tested elsewhere) since spinning up an HTTP server
 * is out-of-scope here.
 *
 * Skipped on CI environments without git or where /private/tmp is locked
 * down — but every supported CAIA dev/CI environment has both.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
  mkdirSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deploySite, resolveSitePath } from '../src/deploy';
import { defaultShellRunner, runOrThrow } from '../src/shell-runner';

import type { SiteConfig } from '../src/sites-config';

let installRoot: string;
let buildWorkspaceRoot: string;
let repoPath: string;

beforeEach(async () => {
  installRoot = mkdtempSync(join(tmpdir(), 'lp-int-install-'));
  buildWorkspaceRoot = mkdtempSync(join(tmpdir(), 'lp-int-buildws-'));
  repoPath = mkdtempSync(join(tmpdir(), 'lp-int-repo-'));

  // Initialise a fixture git repo with one commit on `develop`.
  await runOrThrow(defaultShellRunner, 'git init -b develop', { cwd: repoPath, timeoutMs: 10_000 });
  await runOrThrow(defaultShellRunner, 'git config user.email test@test', { cwd: repoPath, timeoutMs: 5_000 });
  await runOrThrow(defaultShellRunner, 'git config user.name test', { cwd: repoPath, timeoutMs: 5_000 });
  await runOrThrow(defaultShellRunner, 'git config commit.gpgsign false', { cwd: repoPath, timeoutMs: 5_000 });

  mkdirSync(join(repoPath, 'src'), { recursive: true });
  writeFileSync(join(repoPath, 'src', 'index.html'), '<html><title>hello</title></html>', 'utf-8');
  writeFileSync(join(repoPath, 'package.json'), '{"name":"fixture","version":"0.0.0"}', 'utf-8');
  await runOrThrow(defaultShellRunner, 'git add -A', { cwd: repoPath, timeoutMs: 10_000 });
  await runOrThrow(defaultShellRunner, "git commit -m 'initial'", { cwd: repoPath, timeoutMs: 10_000 });

  // Set "origin" to the same repo (self-remote) so `git fetch origin` works
  // without a separate bare repo. Self-remote fetch is a supported git pattern.
  await runOrThrow(defaultShellRunner, `git remote add origin ${repoPath}`, { cwd: repoPath, timeoutMs: 5_000 });
  await runOrThrow(defaultShellRunner, 'git fetch origin', { cwd: repoPath, timeoutMs: 10_000 });
});

afterEach(() => {
  rmSync(installRoot, { recursive: true, force: true });
  rmSync(buildWorkspaceRoot, { recursive: true, force: true });
  rmSync(repoPath, { recursive: true, force: true });
});

const fixtureSite = (repo: string): SiteConfig => ({
  name: 'fixture',
  repo,
  branch: 'develop',
  port: 9999,
  // Trivial "build": copy src/ to dist/. Real Next.js builds are out of scope here.
  buildCmd: 'mkdir -p dist && cp -r src/* dist/',
  startCmd: (p) => `echo start ${p}`,
  healthPath: '/',
  healthMustContain: '<title',
  buildArtifacts: ['dist', 'package.json']
});

describe('deploySite — integration', () => {
  it('clones a real repo, builds, and atomic-swaps the symlink', async () => {
    const site = fixtureSite(repoPath);
    const result = await deploySite(site, {
      installRoot,
      buildWorkspaceRoot,
      // Real shellRunner + real gitOps
      // Stub the health checker (spinning up an actual HTTP server is out of scope)
      healthChecker: async () => ({ ok: true, statusCode: 200, responseTime: 1 }),
      // Stub restart (no LaunchAgent here)
      restartProcess: async () => undefined,
      healthCheckMaxAttempts: 1,
      healthCheckInitialDelayMs: 1,
      logger: { info: () => undefined, error: () => undefined }
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);

    const sitePath = resolveSitePath(installRoot, site.name);
    const currentLink = join(sitePath, 'current');
    expect(existsSync(currentLink)).toBe(true);

    // Verify the build artifact was copied
    const target = readlinkSync(currentLink);
    const indexFile = join(sitePath, target, 'dist', 'index.html');
    expect(existsSync(indexFile)).toBe(true);
    expect(readFileSync(indexFile, 'utf-8')).toContain('<title>hello</title>');

    // package.json was also copied
    const pkgFile = join(sitePath, target, 'package.json');
    expect(existsSync(pkgFile)).toBe(true);

    // state.json should reflect success
    const state = JSON.parse(readFileSync(join(sitePath, 'state.json'), 'utf-8'));
    expect(state.last_deploy_status).toBe('success');
    expect(state.current_sha).toBe(result.sha);
  });

  it('detects new commits across two consecutive deploys', async () => {
    const site = fixtureSite(repoPath);
    const opts = {
      installRoot,
      buildWorkspaceRoot,
      healthChecker: async () => ({ ok: true as const, statusCode: 200, responseTime: 1 }),
      restartProcess: async () => undefined,
      healthCheckMaxAttempts: 1,
      healthCheckInitialDelayMs: 1,
      logger: { info: () => undefined, error: () => undefined }
    };

    const r1 = await deploySite(site, opts);
    expect(r1.status).toBe('success');

    // Second invocation with no new commits → noop
    const r2 = await deploySite(site, opts);
    expect(r2.status).toBe('noop');

    // Add a new commit and deploy again
    writeFileSync(join(repoPath, 'src', 'index.html'), '<html><title>v2</title></html>', 'utf-8');
    await runOrThrow(defaultShellRunner, 'git add -A', { cwd: repoPath, timeoutMs: 10_000 });
    await runOrThrow(defaultShellRunner, "git commit -m 'v2'", { cwd: repoPath, timeoutMs: 10_000 });

    const r3 = await deploySite(site, opts);
    expect(r3.status).toBe('success');
    if (r3.status !== 'success') return;
    if (r1.status !== 'success') return;
    expect(r3.sha).not.toBe(r1.sha);

    // current symlink now points at v2
    const sitePath = resolveSitePath(installRoot, site.name);
    const currentLink = join(sitePath, 'current');
    const target = readlinkSync(currentLink);
    const indexContent = readFileSync(join(sitePath, target, 'dist', 'index.html'), 'utf-8');
    expect(indexContent).toContain('<title>v2</title>');

    // previous symlink should now exist and point at the v1 build
    const previousLink = join(sitePath, 'previous');
    expect(existsSync(previousLink)).toBe(true);
    const prevTarget = readlinkSync(previousLink);
    expect(prevTarget).toContain(r1.sha);
  });

  it('on build failure, leaves current symlink untouched', async () => {
    // Pre-populate a successful first deploy
    const site = fixtureSite(repoPath);
    const baseOpts = {
      installRoot,
      buildWorkspaceRoot,
      healthChecker: async () => ({ ok: true as const, statusCode: 200, responseTime: 1 }),
      restartProcess: async () => undefined,
      healthCheckMaxAttempts: 1,
      healthCheckInitialDelayMs: 1,
      logger: { info: () => undefined, error: () => undefined }
    };
    const r1 = await deploySite(site, baseOpts);
    expect(r1.status).toBe('success');

    const sitePath = resolveSitePath(installRoot, site.name);
    const currentBefore = readlinkSync(join(sitePath, 'current'));

    // Add a new commit but configure a build that fails
    writeFileSync(join(repoPath, 'src', 'index.html'), '<html><title>v2</title></html>', 'utf-8');
    await runOrThrow(defaultShellRunner, 'git add -A', { cwd: repoPath, timeoutMs: 10_000 });
    await runOrThrow(defaultShellRunner, "git commit -m 'will-fail'", { cwd: repoPath, timeoutMs: 10_000 });

    const failingSite: SiteConfig = { ...site, buildCmd: 'exit 1' };
    const r2 = await deploySite(failingSite, baseOpts);

    expect(r2.status).toBe('build-failed');
    // current symlink unchanged
    const currentAfter = readlinkSync(join(sitePath, 'current'));
    expect(currentAfter).toBe(currentBefore);
  });
});

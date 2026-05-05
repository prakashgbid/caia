/**
 * End-to-end deploy pipeline for a single site.
 *
 * Pipeline (per `~/Documents/projects/reports/local-preview-deploys-analysis.md` §Deploy pipeline):
 *   1. acquire per-site lock (refuse if another deploy is running)
 *   2. git fetch origin <branch>; resolve target SHA
 *   3. compare to current symlink target → noop if equal
 *   4. disk-full check → abort if over budget
 *   5. add a detached worktree at <buildWorkspace>/<site>-<sha>
 *   6. run site.buildCmd inside the worktree
 *      → on failure: log incident, remove worktree, return build-failed
 *   7. copy build artifacts (site.buildArtifacts) into installDir/builds/<sha>/
 *   8. atomic-swap the `current` symlink to the new build dir
 *   9. restart the supervised process (kill PID — launchd KeepAlive restarts it)
 *  10. poll the health endpoint
 *      → on failure: rollback symlink, restart, log incident, return health-check-failed
 *  11. prune old builds (>10) keeping symlink targets
 *  12. remove the build worktree
 *  13. update site state.json
 *  14. return success
 *
 * Trust boundary: all paths and commands derive from the compile-time SITES
 * registry. No user-controllable input reaches a shell, fs path, or git
 * command in this module.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { atomicSwap, getCurrentTarget, getPreviousTarget, rollbackToPrevious } from './atomic-swap.js';
import { pollHealthCheck, type HealthCheckResult } from './health-check.js';
import { pruneBuilds, isDiskUsageOk } from './disk-prune.js';
import {
  createDeployFailedRecord,
  createHealthCheckFailedRecord,
  createRollbackRecord,
  logIncident
} from './incident-log.js';
import { defaultShellRunner, type ShellRunner } from './shell-runner.js';
import { makeGitOps, type GitOps } from './git-ops.js';
import { updateSiteState, type SiteState } from './site-state.js';
import type { SiteConfig } from './sites-config.js';

// ─── Types ────────────────────────────────────────────────────────────────

export interface DeployOptions {
  /** Root directory where per-site install dirs live, e.g. ~/Library/Application Support/Stolution/local-preview/ */
  installRoot: string;

  /** Root directory for ephemeral build worktrees, e.g. /private/tmp/local-preview-build/ */
  buildWorkspaceRoot: string;

  /** Directory the incident log lives under. Default: <installRoot>/_incidents/ */
  incidentLogDir?: string;

  /** Soft cap on build storage (bytes). Default: 5 GB. */
  maxDiskBytes?: number;

  /** Number of recent builds to keep when pruning. Default: 10. */
  keepBuildCount?: number;

  /** Health-check tuning. */
  healthCheckMaxAttempts?: number;
  healthCheckInitialDelayMs?: number;

  // ── Injection points (default to real impls; tests override) ───────────

  shellRunner?: ShellRunner;
  gitOps?: GitOps;
  /** Override pollHealthCheck. */
  healthChecker?: (
    url: string,
    mustContain: string,
    maxAttempts: number,
    initialDelayMs: number
  ) => Promise<HealthCheckResult>;
  /** Restart the running process for this site. Default: kill the PID file (launchd KeepAlive restarts). */
  restartProcess?: (site: SiteConfig, sitePath: string) => Promise<void>;
  /** Acquire an in-process lock for a site name. Default: per-site mutex map below. */
  acquireSiteLock?: (siteName: string) => () => void;

  /** Logger. Default: console. */
  logger?: { info: (msg: string, ctx?: unknown) => void; error: (msg: string, ctx?: unknown) => void };

  /** Force a deploy even when SHAs match. */
  force?: boolean;

  /**
   * Optional emit callback for the Mentor event bus. When provided and a
   * deploy succeeds, the deploy pipeline calls
   * `mentorEmit('PRMerged', {prNumber: 0, sha, branch, repo})`. Must never
   * throw — the pipeline expects fire-and-forget semantics.
   *
   * Defaults to undefined (no-op). PR-γ wires this in cli.ts via a Mentor
   * `Client` instance.
   */
  mentorEmit?: (event: 'PRMerged', payload: { prNumber: number; sha: string; branch: string; repo?: string; previousSha?: string }) => void;
}

export type DeployResult =
  | { status: 'noop'; sha: string }
  | {
      status: 'success';
      sha: string;
      previousSha?: string;
      durationMs: number;
      healthCheckMs?: number;
    }
  | { status: 'build-failed'; sha: string; error: string; logTail?: string }
  | {
      status: 'health-check-failed';
      sha: string;
      rolledBackToSha?: string;
      error: string;
    }
  | { status: 'rollback-failed'; sha: string; error: string }
  | { status: 'disk-full'; error: string }
  | { status: 'locked'; error: string }
  | { status: 'aborted'; error: string };

// ─── Per-site lock (in-process) ────────────────────────────────────────────

const inProcessLocks = new Set<string>();

function defaultAcquireSiteLock(siteName: string): () => void {
  if (inProcessLocks.has(siteName)) {
    throw new LockHeldError(`Site lock already held: ${siteName}`);
  }
  inProcessLocks.add(siteName);
  return () => inProcessLocks.delete(siteName);
}

export class LockHeldError extends Error {
  override readonly name = 'LockHeldError';
}

// ─── Path helpers ─────────────────────────────────────────────────────────

export function resolveSitePath(installRoot: string, siteName: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- installRoot+siteName from compile-time SITES registry
  return join(installRoot, siteName);
}

export function resolveBuildDir(sitePath: string, sha: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry; sha from git rev-parse
  return join(sitePath, 'builds', sha);
}

export function resolveBuildWorkspace(buildWorkspaceRoot: string, siteName: string, sha: string): string {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- buildWorkspaceRoot+siteName from compile-time SITES registry; sha from git rev-parse
  return join(buildWorkspaceRoot, `${siteName}-${sha}`);
}

// ─── Default restartProcess (kill PID file → launchd KeepAlive restarts) ──

async function defaultRestartProcess(_site: SiteConfig, sitePath: string): Promise<void> {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
  const pidFile = join(sitePath, 'pid');
  if (!existsSync(pidFile)) {
    // No process running yet (initial deploy or LaunchAgent not yet installed). Nothing to do.
    return;
  }
  try {
    const raw = readFileSync(pidFile, 'utf-8').trim();
    const pid = Number.parseInt(raw, 10);
    if (Number.isFinite(pid) && pid > 1) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch {
        // Process may have already exited. launchd KeepAlive will start a new one.
      }
    }
  } catch {
    // Unreadable PID file — best-effort.
  }
}

// ─── Main entry ───────────────────────────────────────────────────────────

export async function deploySite(site: SiteConfig, opts: DeployOptions): Promise<DeployResult> {
  const {
    installRoot,
    buildWorkspaceRoot,
    maxDiskBytes = 5 * 1024 * 1024 * 1024,
    keepBuildCount = 10,
    healthCheckMaxAttempts = 30,
    healthCheckInitialDelayMs = 333,
    shellRunner = defaultShellRunner,
    gitOps = makeGitOps(shellRunner),
    healthChecker = pollHealthCheck,
    restartProcess = defaultRestartProcess,
    acquireSiteLock = defaultAcquireSiteLock,
    logger = consoleLogger,
    force = false,
    mentorEmit
  } = opts;

  const sitePath = resolveSitePath(installRoot, site.name);
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- installRoot from compile-time SITES registry; '_incidents' is a literal
  const incidentLogDir = opts.incidentLogDir ?? join(installRoot, '_incidents');
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- incidentLogDir from compile-time SITES registry; site.name is a literal from the same registry
  const incidentLogPath = join(incidentLogDir, `${site.name}.jsonl`);
  const stateFallback = { name: site.name, port: site.port };

  // Lock acquisition (or short-circuit if already deploying for this site).
  let releaseLock: (() => void) | undefined;
  try {
    releaseLock = acquireSiteLock(site.name);
  } catch (err) {
    if (err instanceof LockHeldError) {
      return { status: 'locked', error: err.message };
    }
    throw err;
  }

  const startedAt = Date.now();
  try {
    // 1. Make sure sitePath exists.
    if (!existsSync(sitePath)) {
      mkdirSync(sitePath, { recursive: true });
    }

    // 2. Fetch + resolve target SHA.
    await gitOps.fetch(site.repo, site.branch);
    const targetSha = await gitOps.resolveBranchSha(site.repo, site.branch);

    // 3. Compare to current.
    const currentTarget = getCurrentTarget(sitePath);
    const currentSha = currentTarget ? extractShaFromBuildPath(currentTarget) : undefined;

    if (!force && currentSha === targetSha) {
      logger.info(`[${site.name}] noop: already at ${targetSha}`);
      updateSiteState(sitePath, stateFallback, {
        last_deploy_status: 'noop',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: null,
        last_deploy_duration_ms: Date.now() - startedAt
      });
      return { status: 'noop', sha: targetSha };
    }

    // 4. Disk-full check.
    if (!isDiskUsageOk(sitePath, maxDiskBytes)) {
      const msg = `Build storage exceeds ${maxDiskBytes} bytes; aborting deploy`;
      logger.error(`[${site.name}] disk-full: ${msg}`);
      logIncident(incidentLogPath, createDeployFailedRecord(site.name, msg, { sha: targetSha }));
      updateSiteState(sitePath, stateFallback, {
        last_deploy_status: 'disk-full',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: msg,
        last_deploy_duration_ms: Date.now() - startedAt
      });
      return { status: 'disk-full', error: msg };
    }

    // 5. Add build worktree.
    const workspaceDir = resolveBuildWorkspace(buildWorkspaceRoot, site.name, targetSha);
    if (existsSync(workspaceDir)) {
      // Stale worktree from a prior crashed deploy — clean it up first.
      try {
        rmSync(workspaceDir, { recursive: true, force: true });
      } catch (e) {
        logger.error(`[${site.name}] could not clean stale workspace ${workspaceDir}: ${e}`);
      }
    }
    if (!existsSync(buildWorkspaceRoot)) {
      mkdirSync(buildWorkspaceRoot, { recursive: true });
    }

    try {
      await gitOps.worktreeAdd(site.repo, workspaceDir, targetSha);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[${site.name}] worktree add failed: ${msg}`);
      logIncident(
        incidentLogPath,
        createDeployFailedRecord(site.name, `worktree add failed: ${msg}`, { sha: targetSha })
      );
      updateSiteState(sitePath, stateFallback, {
        last_deploy_status: 'aborted',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: `worktree add failed: ${msg}`,
        last_deploy_duration_ms: Date.now() - startedAt
      });
      return { status: 'aborted', error: msg };
    }

    // 6. Run build command.
    logger.info(`[${site.name}] building ${targetSha} in ${workspaceDir}`);
    const buildResult = await shellRunner(site.buildCmd, {
      cwd: workspaceDir,
      timeoutMs: 15 * 60_000 // 15-min build timeout
    });

    if (buildResult.code !== 0) {
      const tail = buildResult.stderr.slice(-2000);
      logger.error(`[${site.name}] build failed (exit ${buildResult.code}): ${tail}`);
      logIncident(
        incidentLogPath,
        createDeployFailedRecord(site.name, `build failed exit ${buildResult.code}`, {
          sha: targetSha,
          stderr_tail: tail
        })
      );
      // Best-effort cleanup of worktree
      await safeRemoveWorktree(gitOps, site.repo, workspaceDir, logger);
      updateSiteState(sitePath, stateFallback, {
        last_deploy_status: 'build-failed',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: `build failed exit ${buildResult.code}`,
        last_deploy_duration_ms: Date.now() - startedAt
      });
      return { status: 'build-failed', sha: targetSha, error: `exit ${buildResult.code}`, logTail: tail };
    }

    // 7. Copy artifacts into install dir.
    const installDir = resolveBuildDir(sitePath, targetSha);
    if (!existsSync(installDir)) {
      mkdirSync(installDir, { recursive: true });
    }
    for (const artifact of site.buildArtifacts) {
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- workspaceDir+artifact from compile-time SITES registry
      const src = join(workspaceDir, artifact);
      // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- installDir+artifact from compile-time SITES registry
      const dst = join(installDir, artifact);
      if (!existsSync(src)) {
        // Build was supposed to produce this artifact. Treat as build failure.
        const msg = `expected build artifact missing: ${artifact}`;
        logger.error(`[${site.name}] ${msg}`);
        logIncident(
          incidentLogPath,
          createDeployFailedRecord(site.name, msg, { sha: targetSha, artifact })
        );
        await safeRemoveWorktree(gitOps, site.repo, workspaceDir, logger);
        updateSiteState(sitePath, stateFallback, {
          last_deploy_status: 'build-failed',
          last_deploy_at: new Date().toISOString(),
          last_deploy_error: msg,
          last_deploy_duration_ms: Date.now() - startedAt
        });
        return { status: 'build-failed', sha: targetSha, error: msg };
      }
      cpSync(src, dst, { recursive: true, force: true });
    }

    // 8. Atomic swap.
    const swapResult = atomicSwap(sitePath, `builds/${targetSha}`);
    if (!swapResult.success) {
      const msg = swapResult.error ?? 'atomic swap failed';
      logger.error(`[${site.name}] swap failed: ${msg}`);
      logIncident(
        incidentLogPath,
        createDeployFailedRecord(site.name, `swap failed: ${msg}`, { sha: targetSha })
      );
      await safeRemoveWorktree(gitOps, site.repo, workspaceDir, logger);
      updateSiteState(sitePath, stateFallback, {
        last_deploy_status: 'aborted',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: msg,
        last_deploy_duration_ms: Date.now() - startedAt
      });
      return { status: 'aborted', error: msg };
    }

    // Decode previous SHA from prior current target (best-effort).
    const previousTargetPath = swapResult.previousTarget;
    const previousSha = previousTargetPath ? extractShaFromBuildPath(previousTargetPath) : undefined;

    // 9. Restart the running process.
    try {
      await restartProcess(site, sitePath);
    } catch (e) {
      logger.error(`[${site.name}] restart failed (non-fatal, will rely on launchd): ${e}`);
    }

    // 10. Health check.
    const url = `http://localhost:${site.port}${site.healthPath}`;
    const healthStart = Date.now();
    const health = await healthChecker(
      url,
      site.healthMustContain,
      healthCheckMaxAttempts,
      healthCheckInitialDelayMs
    );
    const healthCheckMs = Date.now() - healthStart;

    if (!health.ok) {
      logger.error(`[${site.name}] health-check failed: ${health.error ?? 'unknown'}`);
      logIncident(
        incidentLogPath,
        createHealthCheckFailedRecord(site.name, health.error ?? 'unknown', {
          sha: targetSha,
          url,
          response_time_ms: health.responseTime
        })
      );

      // Attempt rollback to previous build.
      const rollback = rollbackToPrevious(sitePath);
      if (!rollback.success) {
        logger.error(`[${site.name}] rollback failed: ${rollback.error ?? 'unknown'}`);
        logIncident(
          incidentLogPath,
          createRollbackRecord(site.name, `rollback failed: ${rollback.error ?? 'unknown'}`, {
            sha: targetSha
          })
        );
        await safeRemoveWorktree(gitOps, site.repo, workspaceDir, logger);
        updateSiteState(sitePath, stateFallback, {
          last_deploy_status: 'rollback-failed',
          last_deploy_at: new Date().toISOString(),
          last_deploy_error: `health failed and rollback failed: ${rollback.error ?? 'unknown'}`,
          last_deploy_duration_ms: Date.now() - startedAt,
          last_health_check_at: new Date().toISOString(),
          last_health_check_status: 'failed'
        });
        return { status: 'rollback-failed', sha: targetSha, error: rollback.error ?? 'unknown' };
      }

      // Restart on the rolled-back build.
      try {
        await restartProcess(site, sitePath);
      } catch (e) {
        logger.error(`[${site.name}] restart-after-rollback failed: ${e}`);
      }

      const rolledBackToSha = rollback.currentTarget
        ? extractShaFromBuildPath(rollback.currentTarget)
        : undefined;

      logIncident(
        incidentLogPath,
        createRollbackRecord(site.name, `rolled back to ${rolledBackToSha ?? 'unknown'}`, {
          failed_sha: targetSha,
          recovered_sha: rolledBackToSha
        })
      );

      const stateUpdate: Partial<SiteState> = {
        last_deploy_status: 'health-check-failed',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: health.error ?? 'unknown',
        last_deploy_duration_ms: Date.now() - startedAt,
        last_health_check_at: new Date().toISOString(),
        last_health_check_status: 'failed'
      };
      if (rolledBackToSha !== undefined) {
        stateUpdate.current_sha = rolledBackToSha;
      }
      updateSiteState(sitePath, stateFallback, stateUpdate);

      await safeRemoveWorktree(gitOps, site.repo, workspaceDir, logger);
      return {
        status: 'health-check-failed',
        sha: targetSha,
        error: health.error ?? 'unknown',
        ...(rolledBackToSha !== undefined ? { rolledBackToSha } : {})
      };
    }

    // 11. Prune old builds.
    const pruneResult = pruneBuilds(sitePath, keepBuildCount);
    if (!pruneResult.success) {
      logger.error(`[${site.name}] prune failed (non-fatal): ${pruneResult.error}`);
    }

    // 12. Remove the build worktree.
    await safeRemoveWorktree(gitOps, site.repo, workspaceDir, logger);

    // 13. Update site state.
    const newPreviousSha = previousSha ?? getPreviousTargetSha(sitePath);
    const stateUpdate: Partial<SiteState> = {
      current_sha: targetSha,
      last_deploy_status: 'success',
      last_deploy_at: new Date().toISOString(),
      last_deploy_error: null,
      last_deploy_duration_ms: Date.now() - startedAt,
      last_health_check_at: new Date().toISOString(),
      last_health_check_status: 'ok',
      process_state: 'running'
    };
    if (newPreviousSha !== undefined) {
      stateUpdate.previous_sha = newPreviousSha;
    }
    updateSiteState(sitePath, stateFallback, stateUpdate);

    logger.info(
      `[${site.name}] deployed ${targetSha} in ${Date.now() - startedAt}ms (health ${healthCheckMs}ms)`
    );

    // Mentor emit (PR-γ): fire-and-forget. The PRMerged event is the
    // best Phase-0 proxy for "a new SHA on origin/<branch> was deployed"
    // since the orchestrator doesn't yet have direct webhook access.
    if (mentorEmit) {
      try {
        mentorEmit('PRMerged', {
          prNumber: 0, // unknown at deploy time; orchestrator may enrich later
          sha: targetSha,
          branch: site.branch,
          repo: site.repo,
          ...(previousSha !== undefined ? { previousSha } : {})
        });
      } catch (e) {
        logger.error(`[${site.name}] mentorEmit threw (ignored): ${e}`);
      }
    }

    const successResult: DeployResult = {
      status: 'success',
      sha: targetSha,
      durationMs: Date.now() - startedAt,
      healthCheckMs
    };
    if (previousSha !== undefined) {
      successResult.previousSha = previousSha;
    }
    return successResult;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[${site.name}] deploy threw: ${msg}`);
    try {
      logIncident(
        incidentLogPath,
        createDeployFailedRecord(site.name, `deploy threw: ${msg}`, {})
      );
    } catch {
      // Ignore logging-on-logging errors
    }
    try {
      updateSiteState(sitePath, stateFallback, {
        last_deploy_status: 'aborted',
        last_deploy_at: new Date().toISOString(),
        last_deploy_error: msg,
        last_deploy_duration_ms: Date.now() - startedAt
      });
    } catch {
      // Ignore state-write failure during error path
    }
    return { status: 'aborted', error: msg };
  } finally {
    if (releaseLock) releaseLock();
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Build dirs are stored as `builds/<sha>` relative to sitePath.
 * The `current` symlink target therefore looks like `builds/<sha>` — extract the SHA.
 */
export function extractShaFromBuildPath(buildPath: string): string | undefined {
  const m = /(?:^|\/)builds\/([0-9a-f]{7,40})(?:\/?$)/.exec(buildPath);
  return m?.[1];
}

function getPreviousTargetSha(sitePath: string): string | undefined {
  const target = getPreviousTarget(sitePath);
  return target ? extractShaFromBuildPath(target) : undefined;
}

/**
 * Best-effort worktree teardown. Always succeeds (logs and continues on
 * partial failure) — the deploy pipeline must not get stuck on cleanup.
 *
 * Three-step strategy (PR-G):
 *
 *   1. `git worktree remove --force` (120s timeout — bumped from 30s after
 *      Stage-6 verify saw the previous timeout fire on a 1.7 GB worktree).
 *   2. **Always-on** `rmSync` if the dir still exists. Even when git
 *      reports success, partial cleanups have been observed; this is a
 *      belt-and-braces safety net.
 *   3. `git worktree prune` to reconcile the worktree registry — necessary
 *      whenever step 2 ran, since `rmSync` leaves the registry entry
 *      dangling and a future `git worktree add` to the same path will
 *      complain.
 *
 * All three steps swallow their own errors. The function returns void
 * unconditionally because every caller uses it for cleanup, never for a
 * decision point. This is intentionally lenient — the next deploy iteration
 * will re-attempt worktree creation with `--force`, which handles a stale
 * dir or registry entry on its own.
 */
export async function safeRemoveWorktree(
  gitOps: GitOps,
  repoPath: string,
  workspaceDir: string,
  logger: { error: (msg: string, ctx?: unknown) => void }
): Promise<void> {
  if (!existsSync(workspaceDir)) return;

  // Step 1: try the canonical `git worktree remove`.
  try {
    await gitOps.worktreeRemove(repoPath, workspaceDir);
  } catch (e) {
    logger.error(`worktree remove failed (will fall back to rmSync): ${e}`);
  }

  // Step 2: always-on safety net. If the dir still exists, blow it away.
  if (existsSync(workspaceDir)) {
    try {
      rmSync(workspaceDir, { recursive: true, force: true });
    } catch (e) {
      logger.error(`rmSync fallback failed: ${e}`);
    }
  }

  // Step 3: reconcile the worktree registry. Cheap; safe to always run.
  try {
    await gitOps.pruneWorktrees(repoPath);
  } catch (e) {
    logger.error(`worktree prune failed (non-fatal): ${e}`);
  }
}

const consoleLogger = {
  info: (msg: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.log(msg, ctx);
    else console.log(msg);
  },
  error: (msg: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.error(msg, ctx);
    else console.error(msg);
  }
};

// Re-exports for convenience
export { defaultShellRunner } from './shell-runner.js';
export { makeGitOps } from './git-ops.js';


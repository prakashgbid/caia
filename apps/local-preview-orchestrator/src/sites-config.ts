/**
 * Site configuration registry for local preview deployments.
 * Defines the three sites, their repos, ports, build/start commands, and health checks.
 *
 * Per-site branch override:
 *   The default branch baked into the SITE_DEFAULTS table can be overridden at
 *   runtime via environment variables of the form:
 *
 *     LOCAL_PREVIEW_<SITE_UPPER_SNAKE>_BRANCH
 *
 *   For example:
 *     LOCAL_PREVIEW_DASHBOARD_BRANCH=develop
 *     LOCAL_PREVIEW_POKER_ZENO_BRANCH=master
 *     LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH=main
 *
 *   This addresses the architectural gap surfaced in Stage-6 verify where
 *   `branch: 'develop'` was hard-coded for all sites but poker-zeno's default
 *   branch is `master` and roulette-community's is `main`.
 *
 *   The override is read at module-load time from `process.env`. Because the
 *   poll daemon and site supervisors are bootstrapped via LaunchAgent plists,
 *   the env var must be exported in the plist's `EnvironmentVariables` block
 *   (or in the user's launchctl context via `launchctl setenv`) for the
 *   override to take effect.
 *
 * Build-command auto-detection (added Phase-2-leg-9):
 *   Per-site build command is resolved based on which lockfile lives in the
 *   worktree at deploy time:
 *     - pnpm-lock.yaml      -> `pnpm install --frozen-lockfile && pnpm build`
 *     - package-lock.json   -> `npm ci && npm run build`
 *     - yarn.lock           -> `yarn install --frozen-lockfile && yarn build`
 *     - none of the above   -> the bake-in default `buildCmd`
 *
 *   This closes the leg-4 Stage-6 gap where poker-zeno + roulette-community
 *   are npm-based projects (have `package-lock.json`, no `pnpm-lock.yaml`)
 *   but the orchestrator was hardcoded to run `pnpm install --frozen-lockfile`,
 *   which corepack rejected. Autodetect is fully passive — no env var, no
 *   external repo change required.
 *
 *   The resolver is wired into deploy.ts at build time (after worktree-add,
 *   before shellRunner). The bake-in `buildCmd` remains the fallback so
 *   tests continue to pass and any unusual setup is still supported.
 *
 * Trust boundary: branch names sourced from env are validated against a
 * conservative allowlist (`/^[A-Za-z0-9_./@-]+$/`) — the same allowlist used
 * by `git-ops.shellEscape`. Anything outside the allowlist is rejected at
 * load time with a clear error so an attacker cannot inject shell
 * metacharacters via the override env var.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface SiteConfig {
  name: string;
  repo: string;
  branch: string;
  port: number;
  /**
   * Bake-in build command. Used as fallback when no lockfile is detected
   * AND when a site explicitly opts out of autodetect. Always set.
   */
  buildCmd: string;
  /**
   * Whether to attempt lockfile-based autodetect at deploy time. When true
   * (default for sites whose primary package manager differs from pnpm OR
   * for any site that wants the orchestrator to be lockfile-aware), the
   * deploy flow calls `resolveBuildCmdForWorkspace(site, workspaceDir)`
   * which inspects the worktree's lockfiles before falling back to the
   * `buildCmd` string above.
   *
   * Defaults to `true` — autodetect is opt-out, since it's strictly a
   * superset of the existing behaviour (an empty / pnpm-lock-only site
   * resolves to the same `pnpm install --frozen-lockfile && pnpm build`).
   */
  autodetectBuildCmd: boolean;
  startCmd: (port: number) => string;
  healthPath: string;
  healthMustContain: string;
  buildArtifacts: string[];
}

interface SiteDefault extends Omit<SiteConfig, 'branch'> {
  /** Default branch — overridable via LOCAL_PREVIEW_<SITE_UPPER_SNAKE>_BRANCH. */
  defaultBranch: string;
}

const SITE_DEFAULTS: SiteDefault[] = [
  {
    name: 'dashboard',
    repo: '/Users/MAC/Documents/projects/caia/apps/dashboard',
    defaultBranch: 'develop',
    port: 5173,
    // CAIA monorepo: dashboard's install runs at the repo root via the
    // workspace pnpm-lock.yaml. Autodetect on the dashboard's own
    // worktree would falsely conclude "no lockfile" because the dashboard
    // package itself has no per-package lockfile — the workspace one is
    // higher up. Disable autodetect for dashboard to keep the existing
    // working behaviour.
    autodetectBuildCmd: false,
    buildCmd: 'pnpm install --frozen-lockfile && pnpm --filter @caia-app/dashboard build',
    startCmd: (p) => `pnpm --filter @caia-app/dashboard exec next start -p ${p}`,
    healthPath: '/',
    healthMustContain: '<title',
    buildArtifacts: ['.next', 'public', 'package.json', 'next.config.js']
  },
  {
    name: 'poker-zeno',
    repo: '/Users/MAC/Documents/projects/poker-zeno',
    // Stage-6 verify (2026-05-05) confirmed poker-zeno's primary branch is master, not develop.
    defaultBranch: 'master',
    port: 5174,
    autodetectBuildCmd: true,
    buildCmd: 'pnpm install --frozen-lockfile && pnpm build',
    startCmd: (p) => `pnpm preview -- --port ${p}`,
    healthPath: '/',
    healthMustContain: '<html',
    buildArtifacts: ['dist', 'package.json']
  },
  {
    name: 'roulette-community',
    repo: '/Users/MAC/Documents/projects/roulette-community',
    // Stage-6 verify (2026-05-05) confirmed roulette-community's primary branch is main, not develop.
    defaultBranch: 'main',
    port: 5175,
    autodetectBuildCmd: true,
    buildCmd: 'pnpm install --frozen-lockfile && pnpm build',
    startCmd: (p) => `pnpm preview -- --port ${p}`,
    healthPath: '/',
    healthMustContain: '<html',
    buildArtifacts: ['dist', 'package.json']
  }
];

/**
 * Strict allowlist matching `git-ops.shellEscape` — branches must look like
 * git refs (alphanumerics, `_`, `.`, `/`, `@`, `-`, `+`).
 */
const BRANCH_ALLOWLIST = /^[A-Za-z0-9_./@\-+]+$/;

/**
 * Convert a site name to its env-var infix:
 *   "dashboard"          -> "DASHBOARD"
 *   "poker-zeno"         -> "POKER_ZENO"
 *   "roulette-community" -> "ROULETTE_COMMUNITY"
 */
export function envVarNameForSiteBranch(siteName: string): string {
  return `LOCAL_PREVIEW_${siteName.replace(/-/g, '_').toUpperCase()}_BRANCH`;
}

/**
 * Resolve the effective branch for a site:
 *   1. If `LOCAL_PREVIEW_<SITE>_BRANCH` env var is set and matches the allowlist,
 *      use it.
 *   2. If it's set but does NOT match the allowlist, throw — refuse to silently
 *      fall back, since this is an attempt to inject shell metacharacters.
 *   3. Otherwise, use the bake-in default.
 */
export function resolveBranch(
  siteName: string,
  defaultBranch: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const varName = envVarNameForSiteBranch(siteName);
  const override = env[varName];
  if (override === undefined || override === '') {
    return defaultBranch;
  }
  if (!BRANCH_ALLOWLIST.test(override)) {
    throw new Error(
      `Invalid branch override for ${siteName}: ${varName}="${override}" — must match ${BRANCH_ALLOWLIST}`
    );
  }
  return override;
}

/**
 * Materialise the SITES list from the defaults table by resolving each branch
 * against the current `process.env`. Re-evaluated on every module access via
 * the `SITES` getter would be cleaner but daemons are long-lived processes
 * where the env is fixed at bootstrap, so module-load resolution is fine.
 */
function buildSites(env: NodeJS.ProcessEnv = process.env): SiteConfig[] {
  return SITE_DEFAULTS.map(({ defaultBranch, ...rest }) => ({
    ...rest,
    branch: resolveBranch(rest.name, defaultBranch, env)
  }));
}

export const SITES: SiteConfig[] = buildSites();

/**
 * Test helper / dynamic-reload: rebuild SITES against an explicit env. Returns
 * a new array; does NOT mutate the exported `SITES`.
 */
export function buildSitesForEnv(env: NodeJS.ProcessEnv): SiteConfig[] {
  return buildSites(env);
}

export function getSiteConfig(siteName: string): SiteConfig {
  const config = SITES.find((s) => s.name === siteName);
  if (!config) {
    throw new Error(`Unknown site: ${siteName}`);
  }
  return config;
}

export function getAllSiteNames(): string[] {
  return SITES.map((s) => s.name);
}

/**
 * Expose the default branch for a site (i.e., what `branch` would be if the
 * env override is unset). Useful for diagnostic output (status dashboard,
 * `caia local-preview status`) so users can see the bake-in default vs. the
 * resolved override.
 */
export function getDefaultBranch(siteName: string): string | undefined {
  return SITE_DEFAULTS.find((s) => s.name === siteName)?.defaultBranch;
}

// ---------------------------------------------------------------------------
// Build-command autodetect (lockfile-driven)
// ---------------------------------------------------------------------------

/** The package managers the autodetect resolver knows about. */
export type DetectedPackageManager = 'pnpm' | 'npm' | 'yarn' | 'unknown';

/**
 * Inspect a worktree directory and decide which package manager owns it
 * based on which lockfile exists. If multiple coexist (rare), pnpm wins
 * over npm wins over yarn (alphabetical tiebreak doesn't matter — this
 * matches CAIA's own preference order).
 *
 * Pure: takes an injected `exists` predicate so tests don't need real FS.
 */
export function detectPackageManager(
  workspaceDir: string,
  exists: (path: string) => boolean = existsSync
): DetectedPackageManager {
  if (exists(join(workspaceDir, 'pnpm-lock.yaml'))) return 'pnpm';
  if (exists(join(workspaceDir, 'package-lock.json'))) return 'npm';
  if (exists(join(workspaceDir, 'yarn.lock'))) return 'yarn';
  return 'unknown';
}

/**
 * Resolve the install + build command for a worktree. Logic:
 *
 *   1. If site.autodetectBuildCmd is false -> bake-in `buildCmd` verbatim.
 *   2. Else inspect the worktree's lockfile via `detectPackageManager`:
 *        - pnpm    -> `pnpm install --frozen-lockfile && pnpm build`
 *        - npm     -> `npm ci && npm run build`
 *        - yarn    -> `yarn install --frozen-lockfile && yarn build`
 *        - unknown -> bake-in `buildCmd` (preserves existing behaviour for
 *                     unusual setups).
 *
 * The bake-in `buildCmd` is only consulted in cases (1) + (4-unknown) so
 * tests that assert the live SITES table's bake-in commands stay valid.
 */
export function resolveBuildCmdForWorkspace(
  site: SiteConfig,
  workspaceDir: string,
  exists: (path: string) => boolean = existsSync
): string {
  if (!site.autodetectBuildCmd) return site.buildCmd;
  const pm = detectPackageManager(workspaceDir, exists);
  switch (pm) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile && pnpm build';
    case 'npm':
      return 'npm ci && npm run build';
    case 'yarn':
      return 'yarn install --frozen-lockfile && yarn build';
    case 'unknown':
    default:
      return site.buildCmd;
  }
}

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
 * Trust boundary: branch names sourced from env are validated against a
 * conservative allowlist (`/^[A-Za-z0-9_./@-]+$/`) — the same allowlist used
 * by `git-ops.shellEscape`. Anything outside the allowlist is rejected at
 * load time with a clear error so an attacker cannot inject shell
 * metacharacters via the override env var.
 */

export interface SiteConfig {
  name: string;
  repo: string;
  branch: string;
  port: number;
  buildCmd: string;
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

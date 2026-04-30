/**
 * CapabilityRegistry — the static catalog of known capabilities + the
 * runtime allowlist (which agents can request which capabilities).
 *
 * The registry is intentionally side-effect-free: operators populate it at
 * orchestrator boot time, the broker reads from it on every issuance.
 */

import {
  CapabilitySchema,
  CapabilityAllowlistEntrySchema,
  type Capability,
  type CapabilityAllowlistEntry,
  type CapabilityName,
} from './types.js';

/** Match a glob-ish pattern: `*` is the only wildcard, matching any chars. */
export function matchScopePattern(pattern: string, value: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*')) return pattern === value;
  // Translate pattern to a regex anchored on both sides.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
  // The pattern is operator-supplied policy text, not user input. Allow-list
  // glob patterns (`*`-only) are pre-escaped in this function and bounded by
  // the registry's static catalogue.
  const re = new RegExp('^' + escaped.replace(/\*/g, '.*') + '$');
  return re.test(value);
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<CapabilityName, Capability>();
  private readonly allowlist: CapabilityAllowlistEntry[] = [];

  registerCapability(input: Capability): void {
    const parsed = CapabilitySchema.parse(input);
    if (this.capabilities.has(parsed.name)) {
      throw new Error(
        `CapabilityRegistry: capability '${parsed.name}' already registered.`,
      );
    }
    this.capabilities.set(parsed.name, parsed);
  }

  registerAllowlistEntry(input: CapabilityAllowlistEntry): void {
    const parsed = CapabilityAllowlistEntrySchema.parse(input);
    if (!this.capabilities.has(parsed.name)) {
      throw new Error(
        `CapabilityRegistry: allowlist references unknown capability '${parsed.name}'.`,
      );
    }
    this.allowlist.push(parsed);
  }

  getCapability(name: CapabilityName): Capability | undefined {
    return this.capabilities.get(name);
  }

  /**
   * Resolve the allowlist entry that authorises (name, agentRole, scope) or
   * return undefined if none matches.
   */
  findAllowlistMatch(
    name: CapabilityName,
    agentRole: string,
    scope: string,
  ): CapabilityAllowlistEntry | undefined {
    return this.allowlist.find(
      (e) =>
        e.name === name &&
        e.agentRole === agentRole &&
        matchScopePattern(e.scopePattern, scope),
    );
  }

  /** Snapshot of the registered capabilities (used by docs + dashboard). */
  listCapabilities(): readonly Capability[] {
    return Array.from(this.capabilities.values());
  }

  listAllowlist(): readonly CapabilityAllowlistEntry[] {
    return this.allowlist.slice();
  }
}

/**
 * Default registry pre-populated with the canonical capability catalogue.
 * Callers can extend it with project-specific entries.
 */
export function createDefaultRegistry(): CapabilityRegistry {
  const reg = new CapabilityRegistry();
  const fiveMin = 5 * 60 * 1000;

  reg.registerCapability({
    name: 'git.push.protected',
    description: 'Push to a protected branch (main / develop / release/*).',
    scope: 'refs/heads/*',
    ttlMs: fiveMin,
    owner: 'release-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'git.push.force',
    description: 'Force or force-with-lease push to any ref.',
    scope: 'refs/heads/*',
    ttlMs: fiveMin,
    owner: 'release-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'gh.pr.merge',
    description: 'Merge a pull request via the GitHub API.',
    scope: 'pr/*',
    ttlMs: fiveMin,
    owner: 'release-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'gh.repo.delete',
    description: 'Delete or archive a GitHub repository.',
    scope: 'repo/*',
    ttlMs: fiveMin,
    owner: 'admin',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'npm.publish',
    description: 'Publish a package to the npm registry.',
    scope: 'pkg/*',
    ttlMs: fiveMin,
    owner: 'release-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'cloudflare.api',
    description: 'Call api.cloudflare.com with the account API token.',
    scope: 'cf/*',
    ttlMs: fiveMin,
    owner: 'deploy-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'cloudflare.pages.deploy.preview',
    description: 'Deploy a Cloudflare Pages preview build.',
    scope: 'cf-pages/*',
    ttlMs: fiveMin,
    owner: 'deploy-bot',
    irreversible: false,
  });
  reg.registerCapability({
    name: 'cloudflare.pages.deploy.production',
    description: 'Promote a Cloudflare Pages build to production.',
    scope: 'cf-pages/*',
    ttlMs: fiveMin,
    owner: 'deploy-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'supabase.admin',
    description: 'Supabase service-key call (DDL, role grants, etc.).',
    scope: 'sb/*',
    ttlMs: fiveMin,
    owner: 'admin',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'supabase.db.reset',
    description: 'Reset a Supabase database (destructive).',
    scope: 'sb/*',
    ttlMs: fiveMin,
    owner: 'admin',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'deploy.production',
    description: 'Generic production deploy (any platform).',
    scope: 'deploy/*',
    ttlMs: fiveMin,
    owner: 'deploy-bot',
    irreversible: true,
  });
  reg.registerCapability({
    name: 'fs.delete.outside.worktree',
    description: 'Delete files outside the per-task worktree.',
    scope: '*',
    ttlMs: fiveMin,
    owner: 'admin',
    irreversible: true,
  });

  return reg;
}

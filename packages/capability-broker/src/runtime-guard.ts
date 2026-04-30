/**
 * Runtime guard — refuses to invoke a privileged shell command unless a
 * matching `CapabilityToken` is in scope.
 *
 * Wired into the Coding Agent's `LocalTestRunner` / `DiffCommitter` /
 * `DodSelfCheck` and the Fix-It Agent's executor before any `spawnSync`.
 *
 * The guard is intentionally permissive on commands it doesn't recognise
 * (`ls`, `pnpm test`, `git status`, etc.) — its job is to fail closed on
 * the small set of irreversible actions, not to be a syscall sandbox. The
 * sandbox layer is `caia/scripts/mcp-sandbox.sb` (Item 2 — MCP hardening).
 */

import type { CapabilityName, CapabilityToken } from './types.js';

/**
 * Patterns that map a (cmd, args) tuple to a required capability + scope.
 * Order matters: the first match wins.
 */
export interface GuardRule {
  readonly capability: CapabilityName;
  /** Returns the scope string when the rule matches, or null. */
  readonly match: (cmd: string, args: readonly string[]) => string | null;
  /** Human-readable description for error messages. */
  readonly description: string;
}

const PROTECTED_REFS = /^(?:refs\/heads\/)?(main|develop|release\/.+)$/;

/** Drop CLI flags (`--force`, `-f`, `--num=3`, `-x=1`) — keep positional args only. */
function positional(args: readonly string[]): string[] {
  return args.filter((a) => !a.startsWith('-'));
}

/** Normalise a git push ref to `refs/heads/<branch>`. */
function normaliseRef(ref: string): string {
  const stripped = ref.replace(/^\+/, '').replace(/.*:/, '');
  if (stripped.startsWith('refs/heads/')) return stripped;
  return `refs/heads/${stripped}`;
}

/**
 * Default ruleset covering: git push to protected branches, git push --force,
 * gh pr merge, gh repo delete/archive, npm/pnpm publish, supabase db reset.
 */
export const DEFAULT_GUARD_RULES: readonly GuardRule[] = [
  {
    capability: 'git.push.force',
    description: 'git push --force / --force-with-lease',
    match: (cmd, args) => {
      if (cmd !== 'git') return null;
      const pos = positional(args);
      if (pos[0] !== 'push') return null;
      const hasForce = args.some(
        (a) =>
          a === '--force' ||
          a === '-f' ||
          a === '--force-with-lease' ||
          a.startsWith('--force-with-lease='),
      );
      if (!hasForce) return null;
      const remote = pos[1] ?? 'origin';
      const ref = pos[2];
      if (!ref) return `${remote}/*`;
      return `${remote}/${normaliseRef(ref)}`;
    },
  },
  {
    capability: 'git.push.protected',
    description: 'git push to a protected branch (main / develop / release/*)',
    match: (cmd, args) => {
      if (cmd !== 'git') return null;
      const pos = positional(args);
      if (pos[0] !== 'push') return null;
      const remote = pos[1] ?? 'origin';
      const ref = pos[2];
      if (!ref) return null;
      const stripped = ref.replace(/^\+/, '').replace(/.*:/, '');
      if (!PROTECTED_REFS.test(stripped)) return null;
      return `${remote}/${normaliseRef(stripped)}`;
    },
  },
  {
    capability: 'gh.pr.merge',
    description: 'gh pr merge',
    match: (cmd, args) => {
      if (cmd !== 'gh') return null;
      const pos = positional(args);
      if (pos[0] !== 'pr' || pos[1] !== 'merge') return null;
      const target = pos[2] ?? '*';
      return `pr/${target}`;
    },
  },
  {
    capability: 'gh.repo.delete',
    description: 'gh repo delete / archive',
    match: (cmd, args) => {
      if (cmd !== 'gh') return null;
      const pos = positional(args);
      if (pos[0] !== 'repo') return null;
      if (pos[1] !== 'delete' && pos[1] !== 'archive') return null;
      const target = pos[2] ?? '*';
      return `repo/${target}`;
    },
  },
  {
    capability: 'npm.publish',
    description: 'npm/pnpm publish',
    match: (cmd, args) => {
      if (cmd !== 'npm' && cmd !== 'pnpm') return null;
      const pos = positional(args);
      if (pos[0] !== 'publish') return null;
      const pkg = pos[1] ?? '*';
      return `pkg/${pkg}`;
    },
  },
  {
    capability: 'supabase.db.reset',
    description: 'supabase db reset',
    match: (cmd, args) => {
      if (cmd !== 'supabase') return null;
      const pos = positional(args);
      if (pos[0] !== 'db' || pos[1] !== 'reset') return null;
      return 'sb/db';
    },
  },
];

export interface GuardContext {
  /** Tokens currently in scope (by capability name). */
  readonly tokensByName: ReadonlyMap<CapabilityName, CapabilityToken>;
  /** Optional clock injection for tests. */
  readonly nowMs?: () => number;
}

export class CapabilityGuardError extends Error {
  constructor(
    public readonly capability: CapabilityName,
    public readonly scope: string,
    message: string,
  ) {
    super(message);
    this.name = 'CapabilityGuardError';
  }
}

/**
 * Throw if `cmd args...` requires a capability that is not currently held.
 * No-op for safe commands (ls, git status, pnpm test, etc.).
 */
export function assertCapabilityForCommand(
  cmd: string,
  args: readonly string[],
  ctx: GuardContext,
  rules: readonly GuardRule[] = DEFAULT_GUARD_RULES,
): void {
  for (const rule of rules) {
    const scope = rule.match(cmd, args);
    if (scope === null) continue;
    const token = ctx.tokensByName.get(rule.capability);
    const now = ctx.nowMs ? ctx.nowMs() : Date.now();
    if (!token) {
      throw new CapabilityGuardError(
        rule.capability,
        scope,
        `runtime guard: '${rule.description}' requires capability '${rule.capability}' (scope='${scope}'). No token in scope.`,
      );
    }
    if (token.expiresAt <= now) {
      throw new CapabilityGuardError(
        rule.capability,
        scope,
        `runtime guard: token for '${rule.capability}' expired at ${new Date(token.expiresAt).toISOString()}.`,
      );
    }
    if (token.scope !== scope && token.scope !== '*') {
      throw new CapabilityGuardError(
        rule.capability,
        scope,
        `runtime guard: token scope='${token.scope}' does not authorise scope='${scope}' for capability '${rule.capability}'.`,
      );
    }
    return; // matched + authorised
  }
  // No rule matched → command is not gated.
}

/** Convenience: build a `GuardContext` from a list of tokens. */
export function guardContextFromTokens(
  tokens: readonly CapabilityToken[],
  nowMs?: () => number,
): GuardContext {
  const map = new Map<CapabilityName, CapabilityToken>();
  for (const t of tokens) {
    map.set(t.name, t);
  }
  if (nowMs) {
    return { tokensByName: map, nowMs };
  }
  return { tokensByName: map };
}

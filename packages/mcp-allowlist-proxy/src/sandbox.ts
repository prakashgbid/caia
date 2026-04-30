/**
 * Sandbox-spawn helper — wraps an MCP server invocation in macOS
 * `sandbox-exec` with the profile at `caia/scripts/mcp-sandbox.sb`.
 *
 * Defence-in-depth, in spawn order:
 *   1. `assertSpawnCommandAllowed` — basename must be on the litellm-style
 *      MCP_STDIO_ALLOWED_COMMANDS list (npx/uvx/python/python3/node/
 *      docker/deno). Mitigates the OX-disclosed Anthropic-SDK
 *      command-injection class (April 2026). Anthropic declined to patch
 *      upstream, so the host enforces.
 *   2. `assertNoPublicBind` — refuses 0.0.0.0 / [::] in args (CVE-2026-23744).
 *   3. macOS `sandbox-exec` profile — `caia/scripts/mcp-sandbox.sb`.
 *
 * On non-Darwin hosts, sandbox-exec is skipped (with a warning) but the
 * allowlist + public-bind guard still apply.
 *
 * Reference: caia/docs/mcp-security.md, third-party-paper §C.3.
 */

import type { SpawnOptions } from 'node:child_process';
import {
  DEFAULT_STDIO_ALLOWED_COMMANDS,
  assertSpawnCommandAllowed,
  assertNoPublicBind,
  readAllowlistFromEnv,
} from './spawn-allowlist.js';

export interface SandboxedSpawnArgs {
  /** The MCP server's command (e.g. `node`, `python`). */
  cmd: string;
  /** Arguments to pass to that command. */
  args: readonly string[];
  /** Per-task worktree path the MCP server may read+write inside. */
  worktree: string;
  /** Caller-supplied scratch / cache dir. */
  cacheDir: string;
  /** Sandbox profile path. */
  profile: string;
  /** Optional spawn options the caller wants merged. */
  spawnOpts?: SpawnOptions;
  /** Operating system override (test seam). */
  platform?: NodeJS.Platform;
  /** Logger called when the sandbox is skipped (non-Darwin host). */
  warnLog?: (msg: string) => void;
  /**
   * Optional override for the spawn-command allowlist. Defaults to the
   * env var `MCP_STDIO_ALLOWED_COMMANDS` parsed by `readAllowlistFromEnv`,
   * or the litellm canonical list when the env var is unset.
   */
  allowedCommands?: readonly string[];
  /**
   * If true (default), enforce the spawn-command allowlist. Tests can pass
   * `false` to construct an unwrapped command for inspection without
   * triggering the guard.
   */
  enforceAllowlist?: boolean;
  /** If true (default), refuse 0.0.0.0 / [::] in args. */
  enforceNoPublicBind?: boolean;
}

/**
 * Compute the (cmd, args) we will hand to `child_process.spawn` after
 * applying every guard. Pure function — does not actually spawn, so it's
 * trivial to unit-test.
 *
 * Throws `SpawnAllowlistError` or `PublicBindError` on a guard failure.
 */
export function buildSandboxedSpawn(args: SandboxedSpawnArgs): {
  cmd: string;
  args: readonly string[];
  spawnOpts: SpawnOptions;
} {
  const allowed = args.allowedCommands ?? readAllowlistFromEnv();
  const enforceAllow = args.enforceAllowlist ?? true;
  const enforceNoBind = args.enforceNoPublicBind ?? true;

  if (enforceAllow) {
    assertSpawnCommandAllowed(args.cmd, allowed);
  }
  if (enforceNoBind) {
    assertNoPublicBind(args.cmd, args.args);
  }

  const platform = args.platform ?? process.platform;
  const env = {
    ...(args.spawnOpts?.env ?? process.env),
    MCP_WORKTREE: args.worktree,
    MCP_CACHE_DIR: args.cacheDir,
  };
  const merged: SpawnOptions = { ...(args.spawnOpts ?? {}), env };
  if (platform !== 'darwin') {
    args.warnLog?.(
      `mcp-allowlist-proxy: platform=${platform} skips sandbox-exec wrapper. Allowlist + public-bind guard still enforced.`,
    );
    return {
      cmd: args.cmd,
      args: args.args,
      spawnOpts: merged,
    };
  }
  // sandbox-exec -f <profile> -D MCP_WORKTREE=<path> -D MCP_CACHE_DIR=<path> -- cmd args...
  const sbxArgs = [
    '-f',
    args.profile,
    '-D',
    `MCP_WORKTREE=${args.worktree}`,
    '-D',
    `MCP_CACHE_DIR=${args.cacheDir}`,
    '--',
    args.cmd,
    ...args.args,
  ];
  return {
    cmd: '/usr/bin/sandbox-exec',
    args: sbxArgs,
    spawnOpts: merged,
  };
}

export { DEFAULT_STDIO_ALLOWED_COMMANDS };

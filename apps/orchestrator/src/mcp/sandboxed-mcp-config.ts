/**
 * SAFETY-002 — wrap `~/.claude/mcp.json` entries through
 * `@chiefaia/mcp-allowlist-proxy`'s `buildSandboxedSpawn`.
 *
 * Claude Code itself is the process that spawns the MCP server (it reads
 * `~/.claude/mcp.json` and calls `child_process.spawn(entry.command,
 * entry.args)`). We can't intercept that spawn from outside Claude
 * Code's process — but we *can* rewrite the `command` + `args` we
 * register in `~/.claude/mcp.json` so Claude Code ends up spawning
 * `sandbox-exec -f <profile> -D MCP_WORKTREE=… -- <original-command>
 * <original-args>`.
 *
 * The same allowlist + public-bind guards that `buildSandboxedSpawn`
 * applies live-fire are also applied at registration time, so a bad
 * entry never makes it into the json file.
 *
 * Reference:
 *   - caia/docs/mcp-security.md
 *   - packages/mcp-allowlist-proxy/src/sandbox.ts (the wrapped helper)
 *   - packages/mcp-allowlist-proxy/src/spawn-allowlist.ts (the guards)
 */

import * as os from 'os';
import * as path from 'path';
import {
  buildSandboxedSpawn,
  type SandboxedSpawnArgs,
} from '@chiefaia/mcp-allowlist-proxy';

/** A bare `~/.claude/mcp.json` entry. */
export interface McpServerEntry {
  command: string;
  args: string[];
  /** Optional env overrides — passed through verbatim. */
  env?: Record<string, string>;
}

/** Per-MCP options that map to `buildSandboxedSpawn`. */
export interface WrapMcpOptions {
  /** Sandbox profile path (default `<repo>/scripts/mcp-sandbox.sb`). */
  profile?: string;
  /** Per-task worktree placeholder. Defaults to `$MCP_WORKTREE` so
   *  Claude Code / the executor can substitute at spawn time. */
  worktree?: string;
  /** Cache dir placeholder. Default `$MCP_CACHE_DIR`. */
  cacheDir?: string;
  /**
   * Override platform (test seam). Defaults to `process.platform`.
   * sandbox-exec only exists on macOS — on other platforms we skip the
   * wrapper but still apply the allowlist + public-bind guards.
   */
  platform?: NodeJS.Platform;
  /** Optional spawn-command allowlist override (test seam). */
  allowedCommands?: readonly string[];
}

const DEFAULT_PROFILE = path.resolve(__dirname, '..', '..', '..', '..', 'scripts', 'mcp-sandbox.sb');

/**
 * Wrap a raw MCP entry through the sandbox + allowlist + public-bind
 * guards. Throws `SpawnAllowlistError` / `PublicBindError` for entries
 * that can't be safely registered.
 */
export function wrapMcpEntry(
  raw: McpServerEntry,
  opts: WrapMcpOptions = {},
): McpServerEntry {
  const sandboxArgs: SandboxedSpawnArgs = {
    cmd: raw.command,
    args: raw.args,
    worktree: opts.worktree ?? '$MCP_WORKTREE',
    cacheDir: opts.cacheDir ?? '$MCP_CACHE_DIR',
    profile: opts.profile ?? DEFAULT_PROFILE,
    platform: opts.platform ?? process.platform,
    spawnOpts: { env: raw.env },
    enforceAllowlist: true,
    enforceNoPublicBind: true,
  };
  if (opts.allowedCommands) {
    sandboxArgs.allowedCommands = opts.allowedCommands;
  }
  const built = buildSandboxedSpawn(sandboxArgs);
  const wrapped: McpServerEntry = {
    command: built.cmd,
    args: [...built.args],
  };
  if (raw.env) wrapped.env = raw.env;
  return wrapped;
}

/**
 * Map of well-known MCP server names → sandbox-required hint. The
 * orchestrator uses this to decide which entries in ~/.claude/mcp.json
 * to migrate when running `conductor harden-mcps`.
 */
export const KNOWN_FIRST_PARTY_MCPS = new Set([
  'mac-mcp',
  'stolution-remote',
  'conductor',
]);

/**
 * Bulk-rewrite an `mcp.json` payload — wrap every entry that hasn't
 * already been wrapped (idempotent). Entries whose `command` is already
 * `/usr/bin/sandbox-exec` are passed through unchanged.
 */
export function wrapMcpConfig(
  config: { mcpServers?: Record<string, McpServerEntry> },
  opts: WrapMcpOptions = {},
): { mcpServers: Record<string, McpServerEntry> } {
  const out: Record<string, McpServerEntry> = {};
  for (const [name, entry] of Object.entries(config.mcpServers ?? {})) {
    if (entry.command === '/usr/bin/sandbox-exec') {
      out[name] = entry; // already wrapped
      continue;
    }
    out[name] = wrapMcpEntry(entry, opts);
  }
  return { mcpServers: out };
}

/** Test helper — quickly assert an entry has been wrapped. */
export function isWrappedEntry(entry: McpServerEntry): boolean {
  return entry.command === '/usr/bin/sandbox-exec';
}

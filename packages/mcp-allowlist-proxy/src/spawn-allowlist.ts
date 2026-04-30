/**
 * STDIO command allowlist for MCP server spawn.
 *
 * Adopted verbatim from litellm's April 15 2026 fix for the "mcp-stdio
 * command injection" attack class disclosed by OX Security. Reference:
 *   https://docs.litellm.ai/blog/mcp-stdio-command-injection-april-2026
 *   https://www.ox.security/blog/the-mother-of-all-ai-supply-chains-critical-systemic-vulnerability-at-the-core-of-the-mcp/
 *
 * The allowlist is enforced at SPAWN time, not config load time — meaning
 * if a malicious prompt successfully injects a new entry into mcp.json
 * pointing at e.g. `bash` or `sh`, this guard still rejects the spawn.
 *
 * Anthropic declined to patch upstream (calls the behaviour "expected"),
 * so the responsibility falls on every host. CAIA's host-side mitigation
 * is this module + the sandbox-exec profile + the capability broker's
 * deny-list on settings-file writes (CurXecute mitigation).
 */

/**
 * Default litellm-derived allowlist. Configurable via the
 * `MCP_STDIO_ALLOWED_COMMANDS` env var (comma-separated).
 *
 * Each entry is matched against the *basename* of the spawn command,
 * so `/usr/bin/python3` matches `python3` and `/Users/MAC/.nvm/versions/
 * node/v20/bin/node` matches `node`.
 */
export const DEFAULT_STDIO_ALLOWED_COMMANDS: readonly string[] = Object.freeze([
  'npx',
  'uvx',
  'python',
  'python3',
  'node',
  'docker',
  'deno',
]);

export class SpawnAllowlistError extends Error {
  constructor(
    public readonly command: string,
    public readonly basename: string,
    allowed: readonly string[],
  ) {
    super(
      `mcp-allowlist-proxy: refusing to spawn '${command}' — basename '${basename}' is not on STDIO_ALLOWED_COMMANDS [${allowed.join(', ')}]. Anthropic SDK command-injection mitigation; see caia/docs/mcp-security.md.`,
    );
    this.name = 'SpawnAllowlistError';
  }
}

/**
 * Read the env-configured allowlist (or the default). Trims whitespace,
 * drops empty entries.
 */
export function readAllowlistFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  const raw = env['MCP_STDIO_ALLOWED_COMMANDS'];
  if (!raw || raw.trim() === '') return DEFAULT_STDIO_ALLOWED_COMMANDS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Compute the basename of a path or command string (cross-platform). */
export function basename(cmd: string): string {
  // Strip trailing slashes, then take the segment after the last forward
  // or back slash.
  const trimmed = cmd.replace(/[/\\]+$/, '');
  const idx = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * Throw `SpawnAllowlistError` if `cmd`'s basename is not on the allowlist.
 * Re-validated every call — operators cannot bypass by mutating the list
 * after a process has started.
 */
export function assertSpawnCommandAllowed(
  cmd: string,
  allowed: readonly string[] = readAllowlistFromEnv(),
): void {
  const base = basename(cmd);
  if (!allowed.includes(base)) {
    throw new SpawnAllowlistError(cmd, base, allowed);
  }
}

/**
 * Reject MCP arg shapes that bind to 0.0.0.0 / [::] / public addresses
 * (CVE-2026-23744 — MCPJam Inspector lesson). Forces 127.0.0.1 / ::1.
 *
 * Matches against the args array (looking for `--host`, `--bind`, or a
 * literal `0.0.0.0` / `::` / `0.0.0.0:<port>` token).
 */
export class PublicBindError extends Error {
  constructor(
    public readonly token: string,
    public readonly cmd: string,
    public readonly args: readonly string[],
  ) {
    super(
      `mcp-allowlist-proxy: refusing to spawn '${cmd}' with public-binding token '${token}' — only 127.0.0.1 / ::1 are allowed (CVE-2026-23744). See caia/docs/mcp-security.md.`,
    );
    this.name = 'PublicBindError';
  }
}

const PUBLIC_BIND_TOKENS = [
  '0.0.0.0',
  '::',
  '[::]',
  '0:0:0:0:0:0:0:0',
];

export function assertNoPublicBind(
  cmd: string,
  args: readonly string[],
): void {
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    // Strip <host>:<port> suffix when checking.
    const hostPart = a.includes(':') ? a.split(':', 2)[0] ?? a : a;
    for (const bad of PUBLIC_BIND_TOKENS) {
      if (a === bad || hostPart === bad) {
        throw new PublicBindError(a, cmd, args);
      }
      if (a.startsWith(`${bad}:`)) {
        throw new PublicBindError(a, cmd, args);
      }
    }
    // --host=<bad> / --bind=<bad>
    if (
      (a.startsWith('--host=') || a.startsWith('--bind=')) &&
      PUBLIC_BIND_TOKENS.some((b) => a.endsWith(`=${b}`) || a.includes(`=${b}:`))
    ) {
      throw new PublicBindError(a, cmd, args);
    }
    // --host <bad>  /  --bind <bad>
    if ((a === '--host' || a === '--bind') && i + 1 < args.length) {
      const next = args[i + 1];
      if (next !== undefined && PUBLIC_BIND_TOKENS.some((b) => next === b || next.startsWith(`${b}:`))) {
        throw new PublicBindError(next, cmd, args);
      }
    }
  }
}

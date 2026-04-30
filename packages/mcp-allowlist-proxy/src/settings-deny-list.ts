/**
 * Settings-file write deny-list — mitigates CVE-2025-54135 (CurXecute).
 *
 * If a prompt-injection convinces the agent to write to mcp.json or one
 * of the IDE settings files, an attacker-controlled MCP server gets
 * registered on the next launch. The capability broker (Item 1, position
 * 3) blocks the underlying file write through `fs.delete.outside.worktree`
 * and the runtime guard, but this module is the application-layer wall:
 * any tool call (mac_write_file, stolution_write_file, fs/edit, etc.)
 * whose `path` argument matches one of the forbidden globs is rejected
 * before it reaches the broker.
 *
 * `.claude/settings.json` is reserved for an additive-merge capability
 * that the broker brokers explicitly (Item 1 §C.1 follow-up). All other
 * settings paths are deny-only.
 *
 * Reference: caia/docs/mcp-security.md, third-party-paper §C.3 + §3.3 #5.
 */

/** Paths that any tool MUST NOT write to. Glob-style (`**` and `*`). */
export const FORBIDDEN_SETTINGS_GLOBS: readonly string[] = Object.freeze([
  '**/mcp.json',
  '**/.mcp.json',
  '**/.cursor/mcp.json',
  '**/.continue/config.json',
  '**/.vscode/settings.json',
  // Claude Desktop config — never written by an agent.
  '**/Library/Application Support/Claude/claude_desktop_config.json',
  '**/.config/claude/claude_desktop_config.json',
]);

/**
 * Path the broker's `additive-merge` capability uses. Direct write still
 * forbidden — agents must request the capability and route through the
 * orchestrator's merge routine.
 */
export const ADDITIVE_MERGE_ALLOWED_PATH = '.claude/settings.json';

export class ForbiddenSettingsPathError extends Error {
  constructor(
    public readonly path: string,
    public readonly matchedGlob: string,
  ) {
    super(
      `mcp-allowlist-proxy: refusing write to '${path}' — matches forbidden glob '${matchedGlob}' (CurXecute / settings-injection mitigation, CVE-2025-54135). See caia/docs/mcp-security.md.`,
    );
    this.name = 'ForbiddenSettingsPathError';
  }
}

/** Translate `**` and `*` into a regex anchored on both sides. */
function compileGlob(glob: string): RegExp {
  // Escape regex metas other than * and /.
  let body = '';
  let i = 0;
  while (i < glob.length) {
    const ch = glob[i] ?? '';
    if (ch === '*' && glob[i + 1] === '*') {
      body += '.*';
      i += 2;
      // Optional trailing slash after **.
      if (glob[i] === '/') {
        body += '/?';
        i += 1;
      }
    } else if (ch === '*') {
      body += '[^/]*';
      i += 1;
    } else if (ch === '/') {
      body += '/';
      i += 1;
    } else if ('.+^${}()|[]\\?'.includes(ch)) {
      body += '\\' + ch;
      i += 1;
    } else {
      body += ch;
      i += 1;
    }
  }
  return new RegExp('^' + body + '$');
}

const COMPILED = FORBIDDEN_SETTINGS_GLOBS.map((g) => ({
  glob: g,
  re: compileGlob(g),
}));

/**
 * Return the matching glob if `path` is forbidden, else null. Path
 * comparisons are normalised — leading `./` is stripped, single trailing
 * slash is stripped, backslashes are mapped to forward slashes.
 */
export function isForbiddenSettingsPath(path: string): string | null {
  const normalised = path
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/$/, '');
  for (const entry of COMPILED) {
    if (entry.re.test(normalised)) {
      // .claude/settings.json is reserved for additive-merge; everything
      // else inside the forbidden globs is deny-only.
      if (normalised.endsWith(ADDITIVE_MERGE_ALLOWED_PATH)) continue;
      return entry.glob;
    }
  }
  return null;
}

/** Throw `ForbiddenSettingsPathError` when path is forbidden. */
export function assertSettingsPathNotForbidden(path: string): void {
  const matched = isForbiddenSettingsPath(path);
  if (matched !== null) {
    throw new ForbiddenSettingsPathError(path, matched);
  }
}

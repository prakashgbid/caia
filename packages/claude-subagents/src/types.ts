/**
 * Public types for @chiefaia/claude-subagents.
 *
 * A subagent is a markdown file with frontmatter that Claude Code (the
 * `claude` CLI) reads from `~/.claude/agents/<name>.md`. When a parent
 * Claude session invokes the Task tool with `subagent_type: "<name>"`,
 * the system prompt for that sub-agent is loaded from the file.
 *
 * @see https://docs.claude.com/en/docs/claude-code/sub-agents
 */

/**
 * Manifest entry for a single CAIA-flavoured Claude Code subagent. The
 * fields here are derived from the YAML frontmatter at the top of each
 * `agents/<name>.md` file.
 */
export interface SubagentManifestEntry {
  /** Stable identifier matching the `name:` frontmatter key + the filename slug. */
  readonly name: string;
  /** One-line description; rendered in the manifest + the file frontmatter. */
  readonly description: string;
  /** Allowed tools for the subagent (Read / Edit / Bash / etc.). */
  readonly tools: readonly string[];
  /** Model preference (`sonnet`, `opus`, `haiku`); subagents inherit when absent. */
  readonly model: 'sonnet' | 'opus' | 'haiku' | null;
  /** CAIA agent tier (1-6) the subagent corresponds to. */
  readonly tier: 2 | 3 | 4 | 5;
  /** Filename relative to the package's `agents/` dir. */
  readonly filename: string;
}

/**
 * Manifest of all CAIA subagents shipped by this package. Stable surface;
 * adding/removing entries is a breaking change.
 */
export interface SubagentManifest {
  readonly version: string;
  readonly entries: readonly SubagentManifestEntry[];
}

/**
 * Options for {@link installSubagents}.
 */
export interface InstallOptions {
  /**
   * Destination directory; defaults to `~/.claude/agents/`. Provided so
   * tests can install into a temp dir and ops can install per-project
   * via `--target`.
   */
  readonly targetDir?: string;
  /**
   * If `true`, overwrite existing files even when the on-disk content
   * matches the shipped definition. Defaults to `false` — content-aware
   * skip means re-running `install` is idempotent.
   */
  readonly force?: boolean;
  /**
   * Subset of subagent names to install. Defaults to "all entries in the
   * manifest" so the common case is one CLI invocation.
   */
  readonly only?: readonly string[];
}

/**
 * Per-file outcome from {@link installSubagents}.
 */
export interface InstallFileResult {
  readonly name: string;
  readonly path: string;
  readonly action: 'written' | 'skipped-unchanged' | 'overwritten';
}

/**
 * Aggregate result from {@link installSubagents}.
 */
export interface InstallResult {
  readonly targetDir: string;
  readonly results: readonly InstallFileResult[];
  readonly writtenCount: number;
  readonly skippedCount: number;
  readonly overwrittenCount: number;
}

/**
 * Per-file outcome from {@link verifyInstalled}.
 */
export interface VerifyFileResult {
  readonly name: string;
  readonly path: string;
  readonly status: 'present-matches' | 'present-drifted' | 'missing';
  /** When status is `present-drifted`, the SHA-256 of on-disk content. */
  readonly onDiskSha?: string;
  /** When status is `present-drifted`, the SHA-256 of the shipped content. */
  readonly shippedSha?: string;
}

/**
 * Aggregate result from {@link verifyInstalled}.
 */
export interface VerifyResult {
  readonly targetDir: string;
  readonly results: readonly VerifyFileResult[];
  readonly presentCount: number;
  readonly driftedCount: number;
  readonly missingCount: number;
  /** True when every shipped subagent is `present-matches`. */
  readonly ok: boolean;
}

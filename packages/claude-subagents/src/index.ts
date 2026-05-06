/**
 * @chiefaia/claude-subagents — public API.
 *
 * Wave 1.1 of the Enterprise Wave 1 campaign — ships canonical CAIA
 * Claude Code subagent definitions (BA / EA / Validator / Test-Design /
 * Coding / Fix-It / Steward / Mentor / Curator / PO) and an installer
 * that copies them into `~/.claude/agents/` so any spawned `claude -p`
 * worker (or interactive session) can delegate to them via the Task tool.
 *
 * @see agent/memory/enterprise_ai_landscape_directive.md (W1-1)
 * @see https://docs.claude.com/en/docs/claude-code/sub-agents
 */

export { MANIFEST, findEntryByName, listAvailable } from './manifest.js';
export { installSubagents, verifyInstalled } from './installer.js';
export { defaultTargetDir, shippedAgentsDir } from './paths.js';
export type {
  InstallFileResult,
  InstallOptions,
  InstallResult,
  SubagentManifest,
  SubagentManifestEntry,
  VerifyFileResult,
  VerifyResult
} from './types.js';

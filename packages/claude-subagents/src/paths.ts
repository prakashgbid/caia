/**
 * Path resolution helpers — defaults to `~/.claude/agents/` for installs
 * and the package-local `agents/` (or `dist/agents/` once built) for the
 * source-of-truth shipped definitions.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Default install directory — `~/.claude/agents/`. */
export function defaultTargetDir(): string {
  return join(homedir(), '.claude', 'agents');
}

/**
 * Locate the `agents/` directory shipped inside this package. We prefer
 * `dist/agents/` (populated by `scripts/copy-agents.mjs` at build time)
 * and fall back to `../agents/` so the package works in both built +
 * source-tree modes (the latter matters for in-repo tests + dev runs).
 */
export function shippedAgentsDir(): string {
  // Compiled file lives at <pkg>/dist/paths.js → shipped agents at
  // <pkg>/dist/agents/. The src-tree fallback resolves to <pkg>/agents/.
  const here = dirname(fileURLToPath(import.meta.url));
  const distAgents = resolve(here, 'agents');
  if (existsSync(distAgents)) return distAgents;
  // Fallback for tests that import from src/ directly without building.
  const srcAgents = resolve(here, '..', 'agents');
  if (existsSync(srcAgents)) return srcAgents;
  // Last-ditch: walk up the workspace.
  const repoAgents = resolve(here, '..', '..', 'agents');
  if (existsSync(repoAgents)) return repoAgents;
  throw new Error(
    `[claude-subagents] could not locate shipped agents/ dir; tried ${distAgents}, ${srcAgents}, ${repoAgents}`
  );
}

/**
 * @chiefaia/system-prompt-block — shared types.
 *
 * The package generates a stable, deterministic, ≤1K-token CAIA primer
 * block to be prepended to every spawned agent's system prompt. The
 * primer contains:
 *
 *   1. Standing-instructions excerpt from agent/memory/MEMORY.md
 *   2. Architecture table-of-contents from caia_architecture.md
 *   3. 10-stage Definition-of-Done from
 *      master_backlog_sequencing_2026-05-05.md
 *
 * The primer must be deterministic (no timestamps, alphabetised section
 * order) and fit inside the configured token budget so agent context
 * windows are never blown out by the primer itself.
 */

/**
 * Options accepted by generateCaiaPrimer. Every CAIA-specific path is a
 * constructor parameter with a CAIA default — Option E shape per
 * agent/memory/agent_architecture_shape_2026-05-06.md.
 *
 * Tests inject fixture corpora to exercise the parameterisation; the CLI
 * (and direct production callers) accept the CAIA defaults.
 */
export interface GenerateCaiaPrimerOptions {
  /**
   * Absolute path to MEMORY.md. Default: the operator's session memory
   * MEMORY.md outside the repo. The standing-instructions section
   * (between `## Standing Instructions` and the next `##` heading) is
   * extracted, lightly normalised, and embedded.
   */
  memoryIndexPath?: string;

  /**
   * Absolute path to caia_architecture.md. Default: the operator's
   * session memory caia_architecture.md outside the repo. The
   * table-of-contents (`##` headings) is extracted as a flat list.
   */
  architectureDocPath?: string;

  /**
   * Absolute path to the master backlog sequencing doc that defines
   * the 10-stage per-item DoD. Default: master_backlog_sequencing_2026-05-05.md.
   * The 10-stage list is extracted by scanning for the headed list
   * "Analyze, Research, Solution, Implement, Unit test, Integration
   * test, Deploy, E2E live verify, Regression test, Document+learn".
   */
  dodSourcePath?: string;

  /**
   * Hard upper bound on the primer's token estimate, in tokens. Default
   * 1000. The codegen aborts (or summarises more aggressively, if
   * `summariseOnOverflow` is true) when the estimate exceeds this.
   */
  tokenBudget?: number;

  /**
   * If true and the primer would exceed `tokenBudget`, the codegen
   * aggressively trims sections (drops anything past `##`-heading depth,
   * truncates standing instructions to the first sentence each) until
   * the budget is satisfied. If false (default), an over-budget primer
   * throws — failing the build loud so the source files can be edited.
   */
  summariseOnOverflow?: boolean;
}

/**
 * The pluggable filesystem reader so tests can fake the source files
 * without touching disk. Production injects {@link defaultFsReader}
 * which reads UTF-8 files synchronously; tests pass an in-memory map.
 */
export interface FsReader {
  readFile(path: string): string;
  exists(path: string): boolean;
}

/**
 * Result of a single generateCaiaPrimer call.
 */
export interface PrimerResult {
  /**
   * The generated primer markdown. Stable across regenerations: no
   * timestamps, alphabetised section ordering inside each block,
   * deterministic line-endings (\n).
   */
  text: string;

  /**
   * Tokens estimated by the internal estimator (a deterministic
   * char-based proxy that does NOT require pulling in tiktoken at
   * runtime — see src/token-estimate.ts for the formula).
   */
  estimatedTokens: number;

  /**
   * Sections actually rendered, in the order they appear. Useful for
   * the snapshot tests + for the CLI's --debug mode.
   */
  sections: Array<'standing-instructions' | 'architecture-toc' | 'dod-checklist'>;

  /**
   * True if the primer was trimmed to satisfy the token budget. Always
   * false when `summariseOnOverflow: false` (in that case an overflow
   * throws instead).
   */
  trimmed: boolean;
}

import { existsSync, readFileSync } from 'node:fs';

/**
 * Default real-filesystem reader. Production uses this directly.
 */
export const defaultFsReader: FsReader = {
  readFile(path: string): string {
    return readFileSync(path, 'utf-8');
  },
  exists(path: string): boolean {
    return existsSync(path);
  }
};

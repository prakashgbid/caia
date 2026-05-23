/**
 * `AccessibilityArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (spec §2.5 — A11y reads from the
 *     Frontend upstream output + designVersion directly; no external
 *     tooling. A future `caia-axe-core` MCP tool will let the architect
 *     run axe-core against a synthesised HTML preview).
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake. Default is `createDefaultSpawner()` which wraps
 * `@chiefaia/claude-spawner`'s real `spawnClaude`.
 *
 * Note: this class does NOT extend `BaseArchitect` from `@caia/architect-kit`
 * because the kit hasn't landed on develop yet (the dispatcher's
 * registration path uses structural typing). The interface is satisfied
 * structurally. When the kit lands, switch to `extends BaseArchitect`.
 */

import { AccessibilityArchitectContract } from './contract.js';
import { runAccessibilityArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildAccessibilitySystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/accessibility-architect` minus the suffix. */
export const ACCESSIBILITY_ARCHITECT_NAME = 'accessibility' as const;

/** V1: no architect-specific tools. Reads Frontend upstream + designVersion directly. */
export const ACCESSIBILITY_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface AccessibilityArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class AccessibilityArchitect implements SpecialistArchitect {
  readonly name = ACCESSIBILITY_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = AccessibilityArchitectContract;
  readonly tools: readonly ToolDefinition[] = ACCESSIBILITY_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: AccessibilityArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildAccessibilitySystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runAccessibilityArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

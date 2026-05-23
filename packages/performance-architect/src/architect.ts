/**
 * `PerformanceArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (spec §2.6 — Performance reads from
 *     the Frontend upstream output directly; no external tooling. A
 *     future `caia-lighthouse-budget-check` / Lighthouse-CI MCP tool
 *     will let the architect run lighthouse-ci against a synthesised
 *     preview).
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

import { PerformanceArchitectContract } from './contract.js';
import { runPerformanceArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildPerformanceSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/performance-architect` minus the suffix. */
export const PERFORMANCE_ARCHITECT_NAME = 'performance' as const;

/** V1: no architect-specific tools. Reads Frontend upstream + designVersion directly. */
export const PERFORMANCE_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface PerformanceArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class PerformanceArchitect implements SpecialistArchitect {
  readonly name = PERFORMANCE_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = PerformanceArchitectContract;
  readonly tools: readonly ToolDefinition[] = PERFORMANCE_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: PerformanceArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildPerformanceSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runPerformanceArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

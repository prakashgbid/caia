/**
 * `ObservabilityArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (spec §2.9 — Observability reads
 *     directly from Backend's upstream output; no external tooling).
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake. Default is `createDefaultSpawner()` which wraps
 * `@chiefaia/claude-spawner`'s real `spawnClaude`.
 *
 * Note: this class does NOT extend `BaseArchitect` from `@caia/architect-kit`
 * because the kit hasn't landed on develop yet. The interface is satisfied
 * structurally. When the kit lands, switch to `extends BaseArchitect`.
 */

import { ObservabilityArchitectContract } from './contract.js';
import { runObservabilityArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildObservabilitySystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/observability-architect` minus the suffix. */
export const OBSERVABILITY_ARCHITECT_NAME = 'observability' as const;

/** V1: no architect-specific tools. Reads upstream Backend output directly. */
export const OBSERVABILITY_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface ObservabilityArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class ObservabilityArchitect implements SpecialistArchitect {
  readonly name = OBSERVABILITY_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = ObservabilityArchitectContract;
  readonly tools: readonly ToolDefinition[] = OBSERVABILITY_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: ObservabilityArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildObservabilitySystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runObservabilityArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

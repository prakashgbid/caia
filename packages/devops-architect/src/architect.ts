/**
 * `DevopsArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (per task brief).
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake.
 *
 * Note: this class does NOT extend `BaseArchitect` from
 * `@caia/architect-kit` — we satisfy `SpecialistArchitect`
 * structurally to mirror the template exactly. When the kit's
 * `BaseArchitect` becomes the canonical extension point (next minor),
 * switch to `extends BaseArchitect`.
 *
 * This is the **17th and final architect**. With it shipped, the
 * canonical roster is complete.
 */

import { DevopsArchitectContract } from './contract.js';
import { runDevopsArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildDevopsSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/devops-architect` minus the suffix. */
export const DEVOPS_ARCHITECT_NAME = 'devops' as const;

/** V1: no architect-specific tools. */
export const DEVOPS_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface DevopsArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class DevopsArchitect implements SpecialistArchitect {
  readonly name = DEVOPS_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = DevopsArchitectContract;
  readonly tools: readonly ToolDefinition[] = DEVOPS_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: DevopsArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildDevopsSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runDevopsArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

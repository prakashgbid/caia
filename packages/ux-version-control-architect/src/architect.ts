/**
 * `UxVersionControlArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 per the task brief.
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake. Default is `createDefaultSpawner()` which wraps
 * `@chiefaia/claude-spawner`'s real `spawnClaude`.
 */

import { UxVersionControlArchitectContract } from './contract.js';
import { runUxVersionControlArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildUxVersionControlSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/ux-version-control-architect` minus the suffix. */
export const UX_VERSION_CONTROL_ARCHITECT_NAME = 'ux-version-control' as const;

/** V1: no architect-specific tools. Reads designVersion directly. */
export const UX_VERSION_CONTROL_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface UxVersionControlArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class UxVersionControlArchitect implements SpecialistArchitect {
  readonly name = UX_VERSION_CONTROL_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = UxVersionControlArchitectContract;
  readonly tools: readonly ToolDefinition[] = UX_VERSION_CONTROL_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: UxVersionControlArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  systemPrompt(): string {
    return buildUxVersionControlSystemPrompt();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runUxVersionControlArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

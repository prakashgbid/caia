/**
 * `ABTestingArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. Tools empty for V1
 * (the `caia-power-calc` MCP tool is a planned V2 addition).
 */

import { ABTestingArchitectContract } from './contract.js';
import { runABTestingArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildABTestingSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/ab-testing-architect` minus the suffix. Canonical ladder entry: `abTesting`. */
export const AB_TESTING_ARCHITECT_NAME = 'abTesting' as const;

/** V1: no architect-specific tools. `caia-power-calc` MCP tool is V2 per spec §2.13. */
export const AB_TESTING_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface ABTestingArchitectConfig {
  spawner?: ArchitectSpawnerFn;
}

export class ABTestingArchitect implements SpecialistArchitect {
  readonly name = AB_TESTING_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = ABTestingArchitectContract;
  readonly tools: readonly ToolDefinition[] = AB_TESTING_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: ABTestingArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  systemPrompt(): string {
    return buildABTestingSystemPrompt();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runABTestingArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

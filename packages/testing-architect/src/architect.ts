/**
 * `TestingArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes.
 *
 * DISTINCTION: Testing Architect sets STRATEGY. Test Author Agent writes
 * test cases per story; Test Reviewer Agent audits coverage. Three
 * different roles, three different agents.
 */

import { TestingArchitectContract } from './contract.js';
import { runTestingArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildTestingSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

export const TESTING_ARCHITECT_NAME = 'testing' as const;

export const TESTING_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface TestingArchitectConfig {
  spawner?: ArchitectSpawnerFn;
}

export class TestingArchitect implements SpecialistArchitect {
  readonly name = TESTING_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = TestingArchitectContract;
  readonly tools: readonly ToolDefinition[] = TESTING_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: TestingArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  systemPrompt(): string {
    return buildTestingSystemPrompt();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runTestingArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

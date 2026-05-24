/**
 * `TimeMachineArchitect` — the `SpecialistArchitect` implementation.
 */

import { TimeMachineArchitectContract } from './contract.js';
import { runTimeMachineArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildTimeMachineSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

export const TIME_MACHINE_ARCHITECT_NAME = 'time-machine' as const;

export const TIME_MACHINE_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface TimeMachineArchitectConfig {
  spawner?: ArchitectSpawnerFn;
}

export class TimeMachineArchitect implements SpecialistArchitect {
  readonly name = TIME_MACHINE_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = TimeMachineArchitectContract;
  readonly tools: readonly ToolDefinition[] = TIME_MACHINE_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: TimeMachineArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  systemPrompt(): string {
    return buildTimeMachineSystemPrompt();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runTimeMachineArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

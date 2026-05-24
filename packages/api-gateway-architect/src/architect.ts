/**
 * `ApiGatewayArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes.
 */

import { ApiGatewayArchitectContract } from './contract.js';
import { runApiGatewayArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildApiGatewaySystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches the `apiGateway` slot in the canonical precedence ladder. */
export const API_GATEWAY_ARCHITECT_NAME = 'apiGateway' as const;

/** V1: no architect-specific tools. */
export const API_GATEWAY_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface ApiGatewayArchitectConfig {
  spawner?: ArchitectSpawnerFn;
}

export class ApiGatewayArchitect implements SpecialistArchitect {
  readonly name = API_GATEWAY_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = ApiGatewayArchitectContract;
  readonly tools: readonly ToolDefinition[] = API_GATEWAY_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: ApiGatewayArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  systemPrompt(): string {
    return buildApiGatewaySystemPrompt();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runApiGatewayArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

/**
 * `SecurityArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (per task brief — the spec §2.10
 *     `caia-cspchecker` tool is V2).
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
 */

import { SecurityArchitectContract } from './contract.js';
import { runSecurityArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildSecuritySystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/security-architect` minus the suffix. */
export const SECURITY_ARCHITECT_NAME = 'security' as const;

/** V1: no architect-specific tools. The `caia-cspchecker` tool is V2. */
export const SECURITY_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface SecurityArchitectConfig {
  spawner?: ArchitectSpawnerFn;
}

export class SecurityArchitect implements SpecialistArchitect {
  readonly name = SECURITY_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = SecurityArchitectContract;
  readonly tools: readonly ToolDefinition[] = SECURITY_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: SecurityArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  systemPrompt(): string {
    return buildSecuritySystemPrompt();
  }

  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runSecurityArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

/**
 * `FrontendArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (spec §2.1 — Frontend reads from
 *     `designVersion` and `businessPlan` directly; no external tooling).
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

import { FrontendArchitectContract } from './contract.js';
import { runFrontendArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildFrontendSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/frontend-architect` minus the suffix. */
export const FRONTEND_ARCHITECT_NAME = 'frontend' as const;

/** V1: no architect-specific tools. Reads designVersion + businessPlan directly. */
export const FRONTEND_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface FrontendArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class FrontendArchitect implements SpecialistArchitect {
  readonly name = FRONTEND_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = FrontendArchitectContract;
  readonly tools: readonly ToolDefinition[] = FRONTEND_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: FrontendArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildFrontendSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runFrontendArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

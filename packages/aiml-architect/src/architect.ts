/**
 * `AIMLArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (per V2 brief — the architect is a
 *     pure spec-generator; it does not invoke external tooling).
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake. Default is `createDefaultSpawner()` which wraps
 * `@chiefaia/claude-spawner`'s real `spawnClaude`.
 *
 * Note: this class does NOT extend `BaseArchitect` from `@caia/architect-kit`
 * because the kit's BaseArchitect hasn't been wired into every package yet.
 * The interface is satisfied structurally. When the kit's BaseArchitect
 * lands as the canonical shape, swap to `extends BaseArchitect`.
 */

import { AIMLArchitectContract } from './contract.js';
import { runAimlArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildAimlSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches the V2 operator brief. */
export const AIML_ARCHITECT_NAME = 'ai-ml' as const;

/** V1: no architect-specific tools. The architect emits specs only. */
export const AIML_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface AIMLArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class AIMLArchitect implements SpecialistArchitect {
  readonly name = AIML_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = AIMLArchitectContract;
  readonly tools: readonly ToolDefinition[] = AIML_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: AIMLArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildAimlSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runAimlArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

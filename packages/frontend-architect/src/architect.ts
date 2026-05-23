/**
 * `FrontendArchitect` — the `SpecialistArchitect` implementation.
 *
 * Extends `BaseArchitect` from `@caia/architect-kit` for shared spend +
 * output-shape helpers. Concrete responsibilities:
 *
 *   - `name`: stable identifier matching the package name minus `-architect`.
 *   - `sectionContract`: the owned-fields declaration from `./contract.ts`.
 *   - `tools`: empty for V1 (Frontend reads `designVersion` + `businessPlan`
 *     directly per spec §2.1; no external tooling).
 *   - `systemPrompt()`: pure function returning the briefing.
 *   - `run(input)`: assembles the prompt, spawns Claude (via injected
 *     spawner), validates, returns `ArchitectOutput`.
 *
 * Constructor takes an optional `spawner` for test injection; the default
 * wraps `@chiefaia/claude-spawner`'s real `spawnClaude`.
 */

import { BaseArchitect } from '@caia/architect-kit';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  ToolDefinition
} from '@caia/architect-kit';

import { FrontendArchitectContract } from './contract.js';
import { runFrontendArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildFrontendSystemPrompt } from './system-prompt.js';

/** Stable name; matches `@caia/frontend-architect` minus the suffix. */
export const FRONTEND_ARCHITECT_NAME = 'frontend' as const;

/** V1: no architect-specific tools. Reads designVersion + businessPlan directly. */
export const FRONTEND_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface FrontendArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class FrontendArchitect extends BaseArchitect {
  readonly name = FRONTEND_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = FrontendArchitectContract;
  override readonly tools: readonly ToolDefinition[] = FRONTEND_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: FrontendArchitectConfig = {}) {
    super();
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  override systemPrompt(): string {
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

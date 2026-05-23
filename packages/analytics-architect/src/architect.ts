/**
 * `AnalyticsArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (spec §2.8 — Analytics reads the
 *     Frontend upstream output + designVersion directly; no external
 *     tooling. A future `caia-event-schema-validator` MCP tool will
 *     let the architect statically verify payloads against a typed
 *     registry.).
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake. Default is `createDefaultSpawner()` which wraps
 * `@chiefaia/claude-spawner`'s real `spawnClaude`.
 *
 * Note: this class does NOT extend `BaseArchitect` from `@caia/architect-kit`
 * because the dispatcher's registration path uses structural typing.
 * The interface is satisfied structurally. When the dispatcher switches
 * to `instanceof BaseArchitect` checks, this class will swap to
 * `extends BaseArchitect` — strict-additive at that point.
 */

import { AnalyticsArchitectContract } from './contract.js';
import { runAnalyticsArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildAnalyticsSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/analytics-architect` minus the suffix. */
export const ANALYTICS_ARCHITECT_NAME = 'analytics' as const;

/** V1: no architect-specific tools. Reads Frontend upstream + designVersion directly. */
export const ANALYTICS_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface AnalyticsArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class AnalyticsArchitect implements SpecialistArchitect {
  readonly name = ANALYTICS_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = AnalyticsArchitectContract;
  readonly tools: readonly ToolDefinition[] = ANALYTICS_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: AnalyticsArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildAnalyticsSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runAnalyticsArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

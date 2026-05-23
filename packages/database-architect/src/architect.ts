/**
 * `DatabaseArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (per task brief — Database reads
 *     from Backend's upstream output + the ticket + business plan
 *     directly; the `caia-db-introspect` tool from the spec is
 *     deferred to V2 when an actual tenant DB is reachable in-process).
 *   - Exposes `run(input)` which delegates to `./run.ts`.
 *
 * Constructor takes an optional `spawner` so tests can inject a
 * deterministic fake. Default is `createDefaultSpawner()` which wraps
 * `@chiefaia/claude-spawner`'s real `spawnClaude`.
 *
 * Note: this class does NOT extend `BaseArchitect` from `@caia/architect-kit`
 * because the kit's BaseArchitect was added late in PR #535; we satisfy
 * the `SpecialistArchitect` interface structurally to mirror the
 * `@caia/frontend-architect` template exactly. When the kit's
 * `BaseArchitect` becomes the canonical extension point (next minor),
 * switch to `extends BaseArchitect`.
 */

import { DatabaseArchitectContract } from './contract.js';
import { runDatabaseArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildDatabaseSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/database-architect` minus the suffix. */
export const DATABASE_ARCHITECT_NAME = 'database' as const;

/** V1: no architect-specific tools. The `caia-db-introspect` tool is V2. */
export const DATABASE_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface DatabaseArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class DatabaseArchitect implements SpecialistArchitect {
  readonly name = DATABASE_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = DatabaseArchitectContract;
  readonly tools: readonly ToolDefinition[] = DATABASE_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: DatabaseArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildDatabaseSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runDatabaseArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

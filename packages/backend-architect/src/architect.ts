/**
 * `BackendArchitect` — the `SpecialistArchitect` implementation.
 *
 * Per spec §1.1, the architect package exports a single class that the
 * EA Dispatcher imports and invokes. The class:
 *
 *   - Holds the section contract as a readonly field.
 *   - Returns the system prompt as a pure function (no runtime state).
 *   - Declares empty `tools` for V1 (per spec §2.2 — Backend reads tenant
 *     Cloudflare Access JWT issuer config via `tenantContext`; the
 *     `caia-backend-introspect` tool is deferred to V2).
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

import { BackendArchitectContract } from './contract.js';
import { runBackendArchitect } from './run.js';
import { createDefaultSpawner, type ArchitectSpawnerFn } from './spawner.js';
import { buildBackendSystemPrompt } from './system-prompt.js';
import type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectSectionContract,
  SpecialistArchitect,
  ToolDefinition
} from './types.js';

/** Stable name; matches `@caia/backend-architect` minus the suffix. */
export const BACKEND_ARCHITECT_NAME = 'backend' as const;

/** V1: no architect-specific tools. The `caia-backend-introspect` tool is V2. */
export const BACKEND_ARCHITECT_TOOLS: readonly ToolDefinition[] = [];

export interface BackendArchitectConfig {
  /** Inject a fake spawner in tests. Default: real claude-spawner-backed spawner. */
  spawner?: ArchitectSpawnerFn;
}

export class BackendArchitect implements SpecialistArchitect {
  readonly name = BACKEND_ARCHITECT_NAME;
  readonly sectionContract: ArchitectSectionContract = BackendArchitectContract;
  readonly tools: readonly ToolDefinition[] = BACKEND_ARCHITECT_TOOLS;

  private readonly spawner: ArchitectSpawnerFn;

  constructor(config: BackendArchitectConfig = {}) {
    this.spawner = config.spawner ?? createDefaultSpawner();
  }

  /**
   * Pure function; identical output every call. The Dispatcher uses this
   * as the subagent's system prompt.
   */
  systemPrompt(): string {
    return buildBackendSystemPrompt();
  }

  /**
   * Runtime entry point. Idempotent given identical input — re-runs
   * REPLACE the architect's owned fields (no append) per the task brief.
   */
  async run(input: ArchitectInput): Promise<ArchitectOutput> {
    return runBackendArchitect(input, {
      spawner: this.spawner,
      systemPrompt: this.systemPrompt(),
      architectName: this.name
    });
  }
}

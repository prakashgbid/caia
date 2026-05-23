/**
 * @caia/database-architect — public surface.
 *
 * Architect #3 of CAIA's 17-architect EA fan-out. Senior DBA / data
 * architect focused on Postgres 16 + Drizzle/Prisma migrations +
 * per-tenant schema isolation. Reads Backend Architect's
 * `apiEndpoints` upstream to enumerate persistence touchpoints; emits
 * table schemas, indexes, migration plans, and tenant-isolation rules.
 *
 * Mirrors the canonical `@caia/frontend-architect` template (architect
 * #1, PR #537).
 *
 * Two-layer surface:
 *   - The class + contract — what the EA Dispatcher consumes.
 *   - Re-exports of run/spawner/validation/invariants for tests + the
 *     conformance suite.
 *
 * Registration: import this package's default `registerWith()` helper
 * to install the architect on a registry. The package does NOT
 * self-register on import (registration is an explicit operator action
 * that the Dispatcher's boot wires up).
 */

import type { ArchitectRegistry } from './types.js';

import { DatabaseArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  DatabaseArchitect,
  DATABASE_ARCHITECT_NAME,
  DATABASE_ARCHITECT_TOOLS
} from './architect.js';
export type { DatabaseArchitectConfig } from './architect.js';

export {
  DatabaseArchitectContract,
  DATABASE_OWNED_SECTIONS,
  DATABASE_OWNED_FIELD_KEYS,
  DATABASE_FIELD_FIX_HINTS,
  DATABASE_ARCHITECT_META,
  databaseArchitectAppliesPredicate
} from './contract.js';

export { buildDatabaseSystemPrompt } from './system-prompt.js';

// Spawner — exposed so the EA Dispatcher (or tests) can inject a custom one.
export {
  createDefaultSpawner,
  buildSpawnPrompt,
  modelTagFor
} from './spawner.js';
export type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from './spawner.js';

// Run + validation — exposed for the conformance test suite.
export { runDatabaseArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export { DATABASE_INVARIANTS } from './invariants.js';
export type { ArchitectInvariant, InvariantSeverity } from './invariants.js';

// Re-export the canonical kit types so consumers have a single import surface.
export type {
  SpecialistArchitect,
  ArchitectInput,
  ArchitectOutput,
  ArchitectUpstreamContext,
  ArchitectBudget,
  ArchitectSpend,
  ArchitectToolCall,
  ReviewerFeedback,
  Ticket,
  BusinessPlan,
  RenderableDesign,
  TenantContext,
  ToolDefinition,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  ArchitectMeta,
  FanoutPolicy
} from './types.js';

/**
 * Register a fresh DatabaseArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): DatabaseArchitect {
  const architect = new DatabaseArchitect();
  registry.register(architect);
  return architect;
}

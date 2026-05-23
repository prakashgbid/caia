/**
 * @caia/backend-architect — public surface.
 *
 * Architect #2 of CAIA's 17-architect EA fan-out. Senior backend engineer
 * focused on Next.js 15 App Router Route Handlers + Server Actions +
 * TypeScript + Zod v3 + Cloudflare Access + Drizzle. Produces tight API
 * endpoint specs the coding worker can implement directly. Does NOT
 * write frontend components or database migrations.
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

import { BackendArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  BackendArchitect,
  BACKEND_ARCHITECT_NAME,
  BACKEND_ARCHITECT_TOOLS
} from './architect.js';
export type { BackendArchitectConfig } from './architect.js';

export {
  BackendArchitectContract,
  BACKEND_OWNED_SECTIONS,
  BACKEND_OWNED_FIELD_KEYS,
  BACKEND_FIELD_FIX_HINTS,
  BACKEND_ARCHITECT_META,
  backendArchitectAppliesPredicate
} from './contract.js';

export { buildBackendSystemPrompt } from './system-prompt.js';

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
export { runBackendArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export { BACKEND_INVARIANTS } from './invariants.js';
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
 * Register a fresh BackendArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): BackendArchitect {
  const architect = new BackendArchitect();
  registry.register(architect);
  return architect;
}

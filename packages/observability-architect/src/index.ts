/**
 * @caia/observability-architect — public surface.
 *
 * Architect #9 of CAIA's 17-architect EA fan-out. Wave-2 architect that
 * depends on Backend Architect's `apiEndpoints` + `errorEnvelope`.
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

import { ObservabilityArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  ObservabilityArchitect,
  OBSERVABILITY_ARCHITECT_NAME,
  OBSERVABILITY_ARCHITECT_TOOLS
} from './architect.js';
export type { ObservabilityArchitectConfig } from './architect.js';

export {
  ObservabilityArchitectContract,
  OBSERVABILITY_OWNED_SECTIONS,
  OBSERVABILITY_OWNED_FIELD_KEYS,
  OBSERVABILITY_FIELD_FIX_HINTS,
  OBSERVABILITY_ARCHITECT_META,
  observabilityArchitectAppliesPredicate
} from './contract.js';

export { buildObservabilitySystemPrompt } from './system-prompt.js';

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
export { runObservabilityArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export { OBSERVABILITY_INVARIANTS } from './invariants.js';
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
 * Register a fresh ObservabilityArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): ObservabilityArchitect {
  const architect = new ObservabilityArchitect();
  registry.register(architect);
  return architect;
}

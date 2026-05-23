/**
 * @caia/performance-architect — public surface.
 *
 * Architect #6 of CAIA's 17-architect EA fan-out. Owns the `performance.*`
 * slice of `tickets.architecture`. Depends on Frontend Architect upstream.
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

import { PerformanceArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  PerformanceArchitect,
  PERFORMANCE_ARCHITECT_NAME,
  PERFORMANCE_ARCHITECT_TOOLS
} from './architect.js';
export type { PerformanceArchitectConfig } from './architect.js';

export {
  PerformanceArchitectContract,
  PERFORMANCE_OWNED_SECTIONS,
  PERFORMANCE_OWNED_FIELD_KEYS,
  PERFORMANCE_FIELD_FIX_HINTS,
  PERFORMANCE_ARCHITECT_META,
  performanceArchitectAppliesPredicate
} from './contract.js';

export { buildPerformanceSystemPrompt } from './system-prompt.js';

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
export { runPerformanceArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export {
  PERFORMANCE_INVARIANTS,
  CWV_GOOD_THRESHOLDS,
  LIGHTHOUSE_FLOORS
} from './invariants.js';
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
 * Register a fresh PerformanceArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): PerformanceArchitect {
  const architect = new PerformanceArchitect();
  registry.register(architect);
  return architect;
}

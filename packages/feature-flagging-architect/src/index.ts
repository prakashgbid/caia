/**
 * @caia/feature-flagging-architect — public surface.
 *
 * Architect #12 of CAIA's 17-architect EA fan-out. Follows the
 * @caia/frontend-architect canonical template.
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

import { FeatureFlaggingArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  FeatureFlaggingArchitect,
  FEATURE_FLAGGING_ARCHITECT_NAME,
  FEATURE_FLAGGING_ARCHITECT_TOOLS
} from './architect.js';
export type { FeatureFlaggingArchitectConfig } from './architect.js';

export {
  FeatureFlaggingArchitectContract,
  FEATURE_FLAGGING_OWNED_SECTIONS,
  FEATURE_FLAGGING_OWNED_FIELD_KEYS,
  FEATURE_FLAGGING_FIELD_FIX_HINTS,
  FEATURE_FLAGGING_ARCHITECT_META,
  featureFlaggingArchitectAppliesPredicate
} from './contract.js';

export { buildFeatureFlaggingSystemPrompt } from './system-prompt.js';

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
export { runFeatureFlaggingArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export { FEATURE_FLAGGING_INVARIANTS } from './invariants.js';
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
 * Register a fresh FeatureFlaggingArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): FeatureFlaggingArchitect {
  const architect = new FeatureFlaggingArchitect();
  registry.register(architect);
  return architect;
}

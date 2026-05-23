/**
 * @caia/accessibility-architect — public surface.
 *
 * Architect #5 of CAIA's 17-architect EA fan-out. Senior accessibility
 * engineer focused on WCAG 2.2 AA, axe-core findings, keyboard navigation,
 * and screen-reader UX. Wave-2 architect — depends on Frontend's
 * `componentTree` + `interactionStates`.
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

import { AccessibilityArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  AccessibilityArchitect,
  ACCESSIBILITY_ARCHITECT_NAME,
  ACCESSIBILITY_ARCHITECT_TOOLS
} from './architect.js';
export type { AccessibilityArchitectConfig } from './architect.js';

export {
  AccessibilityArchitectContract,
  A11Y_OWNED_SECTIONS,
  A11Y_OWNED_FIELD_KEYS,
  A11Y_FIELD_FIX_HINTS,
  ACCESSIBILITY_ARCHITECT_META,
  accessibilityArchitectAppliesPredicate
} from './contract.js';

export { buildAccessibilitySystemPrompt } from './system-prompt.js';

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
export { runAccessibilityArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export { ACCESSIBILITY_INVARIANTS } from './invariants.js';
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
 * Register a fresh AccessibilityArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): AccessibilityArchitect {
  const architect = new AccessibilityArchitect();
  registry.register(architect);
  return architect;
}

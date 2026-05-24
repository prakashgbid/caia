/**
 * @caia/ux-version-control-architect — public surface.
 *
 * Architect #15 of CAIA's 17-architect EA fan-out. Mirrors the
 * Frontend Architect template (architect #1).
 *
 * Two-layer surface:
 *   - The class + contract — what the EA Dispatcher consumes.
 *   - Re-exports of run/spawner/validation/invariants for tests + the
 *     conformance suite.
 *
 * Registration: import this package's `registerWith()` helper to install
 * the architect on a registry. The package does NOT self-register on
 * import (registration is an explicit operator action that the
 * Dispatcher's boot wires up).
 */

import type { ArchitectRegistry } from './types.js';

import { UxVersionControlArchitect } from './architect.js';

export {
  UxVersionControlArchitect,
  UX_VERSION_CONTROL_ARCHITECT_NAME,
  UX_VERSION_CONTROL_ARCHITECT_TOOLS
} from './architect.js';
export type { UxVersionControlArchitectConfig } from './architect.js';

export {
  UxVersionControlArchitectContract,
  UX_VERSION_CONTROL_OWNED_SECTIONS,
  UX_VERSION_CONTROL_OWNED_FIELD_KEYS,
  UX_VERSION_CONTROL_FIELD_FIX_HINTS,
  UX_VERSION_CONTROL_ARCHITECT_META,
  uxVersionControlArchitectAppliesPredicate
} from './contract.js';

export { buildUxVersionControlSystemPrompt } from './system-prompt.js';

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

export { runUxVersionControlArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { UX_VERSION_CONTROL_INVARIANTS } from './invariants.js';
export type { ArchitectInvariant, InvariantSeverity } from './invariants.js';

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
 * Register a fresh UxVersionControlArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): UxVersionControlArchitect {
  const architect = new UxVersionControlArchitect();
  registry.register(architect);
  return architect;
}

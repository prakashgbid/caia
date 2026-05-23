/**
 * @caia/seo-architect — public surface.
 *
 * Architect #4 of CAIA's 17-architect EA fan-out. Mirrors the canonical
 * Frontend Architect template (merged PR #537).
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

import { SeoArchitect } from './architect.js';

// Main exports — the Dispatcher imports these.
export {
  SeoArchitect,
  SEO_ARCHITECT_NAME,
  SEO_ARCHITECT_TOOLS
} from './architect.js';
export type { SeoArchitectConfig } from './architect.js';

export {
  SeoArchitectContract,
  SEO_OWNED_SECTIONS,
  SEO_OWNED_FIELD_KEYS,
  SEO_FIELD_FIX_HINTS,
  SEO_ARCHITECT_META,
  seoArchitectAppliesPredicate
} from './contract.js';

export { buildSeoSystemPrompt } from './system-prompt.js';

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
export { runSeoArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

// Invariants — exposed for the EA Reviewer's registry.
export {
  SEO_INVARIANTS,
  RICH_RESULTS_REQUIRED_PROPS,
  validateRichResults
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
 * Register a fresh SeoArchitect on the given registry. The
 * Dispatcher's boot wiring calls this in its `registry.ts` per spec §7.1.
 */
export function registerWith(registry: ArchitectRegistry): SeoArchitect {
  const architect = new SeoArchitect();
  registry.register(architect);
  return architect;
}

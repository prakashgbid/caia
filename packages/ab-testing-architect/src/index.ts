/**
 * @caia/ab-testing-architect — public surface.
 *
 * Architect #13 of CAIA's 17-architect EA fan-out. Senior experimentation
 * engineer focused on A/B testing rigor — hypothesis framing, sample-size
 * power calculations, sequential/Bayesian/frequentist readout, variant
 * routing, and holdout analysis. Wave-3 architect (the lone wave-3
 * entry per spec §3.3) — depends on Analytics's `eventTaxonomy` +
 * `funnelDefinitions` + `conversionGoals` AND Feature Flagging's
 * `flagsSchema`.
 */

import type { ArchitectRegistry } from './types.js';

import { ABTestingArchitect } from './architect.js';

export {
  ABTestingArchitect,
  AB_TESTING_ARCHITECT_NAME,
  AB_TESTING_ARCHITECT_TOOLS
} from './architect.js';
export type { ABTestingArchitectConfig } from './architect.js';

export {
  ABTestingArchitectContract,
  AB_TESTING_OWNED_SECTIONS,
  AB_TESTING_OWNED_FIELD_KEYS,
  AB_TESTING_FIELD_FIX_HINTS,
  AB_TESTING_ARCHITECT_META,
  abTestingArchitectAppliesPredicate
} from './contract.js';

export { buildABTestingSystemPrompt } from './system-prompt.js';

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

export { runABTestingArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { AB_TESTING_INVARIANTS, computeReferenceSampleSize } from './invariants.js';
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

export function registerWith(registry: ArchitectRegistry): ABTestingArchitect {
  const architect = new ABTestingArchitect();
  registry.register(architect);
  return architect;
}

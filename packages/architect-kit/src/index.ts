/**
 * @caia/architect-kit — public surface.
 *
 * The 17 specialist-architect packages depend on this kit. The EA Dispatcher
 * also depends on it (it reads the registry + computes waves + composes
 * fields). The EA Reviewer reads SectionContracts off this kit to compute
 * completeness coverage.
 */

export type {
  // Upstream artifacts
  Ticket,
  BusinessPlan,
  RenderableDesign,
  TenantContext,

  // Runtime inputs
  ArchitectBudget,
  ArchitectInput,
  ArchitectUpstreamContext,
  ReviewerFeedback,

  // Runtime outputs
  ArchitectOutput,
  ArchitectSpend,
  ArchitectToolCall,

  // Tool definition
  ToolDefinition,
} from './types.js';

export type {
  ArchitectName,
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  FanoutPolicy,
} from './architect-section-contract.js';

export {
  contractPaths,
  findDuplicatePaths,
  findOverlappingPaths,
} from './architect-section-contract.js';

export type { SpecialistArchitect } from './specialist-architect.js';

export { BaseArchitect } from './base-architect.js';

export {
  CANONICAL_PRECEDENCE_LADDER,
  CANONICAL_ARCHITECT_COUNT,
  precedenceRank,
  comparePrecedence,
  higherPrecedence,
  assertLadderShape,
} from './precedence.js';

export {
  ArchitectRegistry,
  ArchitectRegistryError,
  getDefaultArchitectRegistry,
  resetDefaultArchitectRegistry,
  registerArchitect,
  disjointness,
  overlapBetween,
} from './architect-registry.js';
export type { RegistryEntry } from './architect-registry.js';

export {
  computeWaves,
  computeWavesFromMeta,
  flattenWaves,
  waveOf,
  CycleDetectedError,
  UnknownDependencyError,
} from './dependency-graph.js';
export type { Wave } from './dependency-graph.js';

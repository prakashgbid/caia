/**
 * Type re-exports — the canonical defs live in `@caia/architect-kit`.
 * Mirrors frontend/analytics architect templates verbatim.
 */

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
  ArchitectName,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  ArchitectMeta,
  FanoutPolicy
} from '@caia/architect-kit';

export {
  ArchitectRegistry,
  ArchitectRegistryError,
  CANONICAL_PRECEDENCE_LADDER,
  BaseArchitect,
  contractPaths,
  disjointness,
  findDuplicatePaths,
  findOverlappingPaths,
  precedenceRank
} from '@caia/architect-kit';

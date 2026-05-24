/**
 * Type re-exports — the canonical defs live in `@caia/architect-kit`
 * (sibling package; landed on develop via PR #535).
 *
 * Mirrors the canonical `@caia/frontend-architect` template verbatim —
 * only the architect-specific field-spec lives in `./contract.ts`.
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

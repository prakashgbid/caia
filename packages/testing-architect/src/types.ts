/**
 * Type re-exports — the canonical defs live in `@caia/architect-kit`
 * (sibling package; landed on develop via PR #535).
 *
 * This module exists as a thin re-export so the rest of this package
 * has a single import surface. Mirrors `@caia/frontend-architect`'s
 * `types.ts` verbatim — the shape is intentionally identical across
 * all 17 architects so the Dispatcher can inject a single shared
 * spawner factory.
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

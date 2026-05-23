/**
 * Type re-exports — the canonical defs live in `@caia/architect-kit`
 * (sibling package, see its `src/types.ts` + `src/specialist-architect.ts`).
 *
 * This module exists as a thin re-export so the rest of this package
 * has a single import surface. Other architects following this template
 * should mirror this file verbatim — only the architect-specific
 * field-spec lives in `./contract.ts`.
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

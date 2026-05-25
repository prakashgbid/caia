/**
 * @caia/principal-po — facade re-export package.
 *
 * Memory (`agent-memory/project_caia_canonical_pipeline_2026-05-22.md`) names a
 * single "Principal PO" role at Step 6. On disk the role is split across three
 * packages. This facade re-exports their public APIs under the canonical names
 * memory uses, so consumers stay aligned with the pipeline doc.
 *
 * Operator decision (2026-05-25): keep memory's name; ship a thin facade.
 * Not a re-implementation — every export delegates to a subordinate package.
 *
 * See ./README.md for the rationale + the underlying-package map.
 */

import {
  PORecursiveDecomposer,
  type DecomposeRootOptions,
  type DecomposeRootResult,
} from '@chiefaia/decomposer-recursive';

// ── Story-hierarchy decomposition (Principal PO part (a) — decompose) ──
export { PORecursiveDecomposer } from '@chiefaia/decomposer-recursive';
export type {
  DecomposeOneOptions,
  DecomposeRootOptions,
  DecomposeRootResult,
  DecomposedTreeNode,
  ParentNode,
} from '@chiefaia/decomposer-recursive';

/**
 * Canonical-name entry point for story-hierarchy decomposition.
 * Thin function-shape wrapper over `new PORecursiveDecomposer().decomposeRoot(opts)`.
 */
export const decomposeStoryHierarchy = (
  opts: DecomposeRootOptions,
): Promise<DecomposeRootResult> => new PORecursiveDecomposer().decomposeRoot(opts);

// ── Story-graph scheduling (Stage-12 fan-out used by Principal PO downstream) ──
export { schedule as scheduleStoryGraph } from '@caia/principal-engineer';
export type {
  ScheduleInput,
  ScheduleResult,
  SchedulerConfig,
  Ticket,
  TicketGraph,
  WaveBucket,
  WavePlan,
} from '@caia/principal-engineer';

// ── Architect-kit common utilities (registry + waves + types) ──
export {
  ArchitectRegistry,
  BaseArchitect,
  computeWaves,
  computeWavesFromMeta,
} from '@caia/architect-kit';
export type {
  ArchitectInput,
  ArchitectOutput,
  ArchitectName,
  ArchitectMeta,
  RenderableDesign,
  Ticket as ArchitectTicket,
  TenantContext,
  Wave,
} from '@caia/architect-kit';

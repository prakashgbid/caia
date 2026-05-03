/**
 * @chiefaia/steward-core — public API.
 *
 * DevOps Steward Agent — process-graph evaluator (propose-only, P0).
 *
 * Reference: devops-steward-agent-design-2026-05-03.md.
 */

export { applyInvariants, evaluateProcess } from './evaluate.js';
export type { EvaluateOptions } from './evaluate.js';
export { loadProcessGraph } from './load-process-graph.js';
export type { LoadResult } from './load-process-graph.js';
export {
  evaluatePredicate,
  PredicateError,
} from './predicate.js';
export type { PredicateContext } from './predicate.js';
export {
  EventSourceSchema,
  EventTypeSchema,
  RepoIdSchema,
  StewardEventSchema,
  makeEventId,
} from './events.js';
export type { EventSource, EventType, RepoId, StewardEvent } from './events.js';
export {
  ProcessSeveritySchema,
  RecoveryKindSchema,
  InvariantSchema,
  TransitionSchema,
  OnMissSchema,
  ProcessSchema,
  ProcessDriftSchema,
  validateProcessGraph,
} from './process-graph.js';
export type {
  ProcessSeverity,
  RecoveryKind,
  Invariant,
  Transition,
  OnMiss,
  Process,
  ProcessDrift,
} from './process-graph.js';

export const STEWARD_CORE_VERSION = '0.1.0';

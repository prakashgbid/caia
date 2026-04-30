/**
 * Public API for @chiefaia/decomposer-recursive.
 *
 * P0 (this slice): scope detector + atomicity classifier + Zod schemas
 * + structured-output helper. The orchestrator engine, per-scope
 * decomposers, and judge pair land in PRs 2 + 3 respectively.
 */

// ─── Types ──────────────────────────────────────────────────────────────

export type {
  AuditEntry,
  AtomicityVerdict,
  CancellationSignal,
  ChildTicket,
  ClarifyingQuestion,
  Decomposition,
  DependencyEdge,
  ExistingArtifactRef,
  ScopeDetection,
  StoryScope,
} from './types.js';

export { STORY_SCOPES, STORY_SCOPE_ORDER, isStoryScope } from './types.js';

// ─── Schemas ────────────────────────────────────────────────────────────

export {
  AuditEntrySchema,
  AtomicityLlmOutputSchema,
  ChildTicketArraySchema,
  ChildTicketSchema,
  ClarifyingQuestionSchema,
  DecompositionSchema,
  DependencyEdgeSchema,
  ExistingArtifactRefSchema,
  ScopeDetectionLlmOutputSchema,
  StoryScopeSchema,
} from './schemas.js';

export type {
  ChildTicketSchemaT,
  ChildTicketArraySchemaT,
  DecompositionSchemaT,
  ScopeDetectionLlmOutputT,
  AtomicityLlmOutputT,
} from './schemas.js';

// ─── Structured-output helper ───────────────────────────────────────────

export {
  callStructured,
  extractJson,
  StructuredOutputCancelled,
  StructuredOutputParseError,
} from './structured-output.js';

export type {
  StructuredOutputOptions,
  StructuredOutputResult,
} from './structured-output.js';

// ─── Scope detector ─────────────────────────────────────────────────────

export {
  SCOPE_DETECTION_TASK_TYPE,
  detectScope,
} from './scope-detector.js';

export type { DetectScopeOptions } from './scope-detector.js';

// ─── Atomicity classifier ──────────────────────────────────────────────

export {
  ATOMICITY_CLASSIFICATION_TASK_TYPE,
  ATOMICITY_RUBRICS,
  classifyAtomicity,
} from './atomicity-classifier.js';

export type { ClassifyAtomicityOptions } from './atomicity-classifier.js';

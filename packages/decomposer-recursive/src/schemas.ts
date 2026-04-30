/**
 * Zod schemas for the recursive decomposer.
 *
 * These are the runtime source of truth for LLM-output validation.
 * Every `decompose` / `classifyAtomicity` / `detectScope` call parses
 * the model response through one of these schemas; on parse failure,
 * the LLM is re-invoked with the parse error appended to the prompt
 * (max 2 retries — see `structured-output.ts`).
 *
 * The TypeScript types in `./types.ts` are kept hand-written for
 * documentation and IDE clarity, but they MUST stay structurally
 * compatible with these schemas. The cross-check tests in
 * `tests/schemas.test.ts` enforce that.
 */

import { z } from 'zod';
import { STORY_SCOPES } from '@chiefaia/ticket-template';

// ─── Primitive ──────────────────────────────────────────────────────────

export const StoryScopeSchema = z.enum(STORY_SCOPES);

// ─── ExistingArtifactRef ────────────────────────────────────────────────

export const ExistingArtifactRefSchema = z.object({
  source: z.enum(['feature', 'arch_artifact']),
  id: z.string().min(1),
  name: z.string().min(1),
  score: z.number().min(0).max(1),
  hint: z.string().optional(),
});

// ─── ChildTicket ────────────────────────────────────────────────────────

export const ChildTicketSchema = z
  .object({
    id: z.string().min(1),
    scope: StoryScopeSchema,
    title: z.string().min(3).max(200),
    description: z.string().min(10),
    acceptanceCriteria: z.array(z.string().min(8)).optional(),
    inScope: z.array(z.string().min(5)),
    outOfScope: z.array(z.string()),
    dependencies: z.array(z.string()),
    estimatedAtomic: z.boolean(),
    existingArtifacts: z.array(ExistingArtifactRefSchema),
    lifecycle: z.enum(['new', 'enhance', 'reuse']),
  })
  .refine((c) => !c.dependencies.includes(c.id), {
    message: 'A child cannot depend on itself',
    path: ['dependencies'],
  });

/**
 * Schema for an array of children, with cross-child invariants:
 *   - No two children share an id.
 *   - Every dependency references either a sibling id or is left for
 *     the orchestrator to mark as external (the engine resolves this
 *     in PR 2). For PR 1 the schema only enforces no-self-dep.
 */
export const ChildTicketArraySchema = z
  .array(ChildTicketSchema)
  .refine(
    (children) => {
      const ids = new Set<string>();
      for (const c of children) {
        if (ids.has(c.id)) return false;
        ids.add(c.id);
      }
      return true;
    },
    { message: 'Sibling child IDs must be unique' },
  );

// ─── ClarifyingQuestion ─────────────────────────────────────────────────

export const ClarifyingQuestionSchema = z.object({
  id: z.string().min(1),
  parentNodeId: z.string().min(1),
  question: z.string().min(5),
  proposedAnswers: z.array(z.string()),
  blocksBranch: z.boolean(),
  rationale: z.string().min(5),
});

// ─── DependencyEdge ─────────────────────────────────────────────────────

export const DependencyEdgeSchema = z
  .object({
    fromChildId: z.string().min(1),
    toChildId: z.string().min(1),
    kind: z.enum(['blocks', 'soft', 'capability']),
    rationale: z.string().min(3),
  })
  .refine((e) => e.fromChildId !== e.toChildId, {
    message: 'A dependency edge cannot self-loop',
    path: ['toChildId'],
  });

// ─── AuditEntry ─────────────────────────────────────────────────────────

export const AuditEntrySchema = z.object({
  parentNodeId: z.string().min(1),
  parentScope: StoryScopeSchema,
  childScope: StoryScopeSchema,
  attempt: z.number().int().min(1),
  promptTextHash: z.string().min(1),
  model: z.string().min(1),
  tokensIn: z.number().int().min(0),
  tokensOut: z.number().int().min(0),
  costUsd: z.number().min(0),
  durationMs: z.number().min(0),
  alternativesConsidered: z.number().int().min(0),
  coverageScore: z.number().min(0).max(1).nullable(),
  disjointnessScore: z.number().min(0).max(1).nullable(),
  ambiguityDetected: z.boolean(),
  questionsEmittedCount: z.number().int().min(0),
  decisionRationale: z.string(),
  childrenCount: z.number().int().min(0),
  outcome: z.enum([
    'committed',
    'reflexive-retry',
    'stuck',
    'awaiting-clarification',
  ]),
});

// ─── Decomposition (engine return shape) ────────────────────────────────

export const DecompositionSchema = z.object({
  childTickets: ChildTicketArraySchema,
  clarifyingQuestions: z.array(ClarifyingQuestionSchema),
  dependencies: z.array(DependencyEdgeSchema),
  confidence: z.number().min(0).max(1).nullable(),
  judgeScores: z.object({
    coverage: z.number().min(0).max(1).nullable(),
    disjointness: z.number().min(0).max(1).nullable(),
  }),
  audit: AuditEntrySchema,
});

// ─── Scope-detection LLM output ─────────────────────────────────────────

/**
 * The schema the scope-detection LLM must return. Strict — extra keys
 * are stripped by `.passthrough()` is intentionally NOT used.
 */
export const ScopeDetectionLlmOutputSchema = z.object({
  targetScope: StoryScopeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(3),
});

// ─── Atomicity-classifier LLM output ────────────────────────────────────

export const AtomicityLlmOutputSchema = z.object({
  atomic: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(3),
  failedCriteria: z.array(z.string()),
});

// ─── Re-export for inference convenience ────────────────────────────────

export type ChildTicketSchemaT = z.infer<typeof ChildTicketSchema>;
export type ChildTicketArraySchemaT = z.infer<typeof ChildTicketArraySchema>;
export type DecompositionSchemaT = z.infer<typeof DecompositionSchema>;
export type ScopeDetectionLlmOutputT = z.infer<typeof ScopeDetectionLlmOutputSchema>;
export type AtomicityLlmOutputT = z.infer<typeof AtomicityLlmOutputSchema>;

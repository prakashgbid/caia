import { z } from 'zod';
import { STORY_SCOPES } from '@chiefaia/ticket-template';

export const StoryScopeSchema = z.enum(STORY_SCOPES);

export const ExistingArtifactRefSchema = z.object({
  source: z.enum(['feature', 'arch_artifact']),
  id: z.string().min(1),
  name: z.string().min(1),
  score: z.number().min(0).max(1),
  hint: z.string().optional(),
});

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

export const ClarifyingQuestionSchema = z.object({
  id: z.string().min(1),
  parentNodeId: z.string().min(1),
  question: z.string().min(5),
  proposedAnswers: z.array(z.string()),
  blocksBranch: z.boolean(),
  rationale: z.string().min(5),
});

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
  outcome: z.enum(['committed', 'reflexive-retry', 'stuck', 'awaiting-clarification']),
});

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

export const ScopeDetectionLlmOutputSchema = z.object({
  targetScope: StoryScopeSchema,
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(3),
});

export const AtomicityLlmOutputSchema = z.object({
  atomic: z.boolean(),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(3),
  failedCriteria: z.array(z.string()),
});

export type ChildTicketSchemaT = z.infer<typeof ChildTicketSchema>;
export type ChildTicketArraySchemaT = z.infer<typeof ChildTicketArraySchema>;
export type DecompositionSchemaT = z.infer<typeof DecompositionSchema>;
export type ScopeDetectionLlmOutputT = z.infer<typeof ScopeDetectionLlmOutputSchema>;
export type AtomicityLlmOutputT = z.infer<typeof AtomicityLlmOutputSchema>;

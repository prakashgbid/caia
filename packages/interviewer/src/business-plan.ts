/**
 * @caia/interviewer — BusinessPlanV2 zod schema + section helpers.
 *
 * The canonical contract is `skills/playbook/business-plan-schema.json`
 * (JSON Schema draft 2020-12). This file mirrors it as a zod schema so:
 *
 *   1. The orchestrator can parse / validate plans at runtime.
 *   2. TypeScript callers get a typed `BusinessPlanV2` shape.
 *   3. The persistence layer can snapshot/restore plans from JSONB
 *      without runtime drift from the canonical schema.
 *
 * The zod tree intentionally stays *narrower* than the JSON Schema in
 * a few places (e.g. structured payloads default to `passthrough`)
 * because section structures are pillar-specific and Step 4 is the
 * primary consumer of typed accessors. The interviewer engine only
 * needs to read/update `content`, `confidence`, `decisionedAtTurn`,
 * and `pillarsCovered`.
 */

import { z } from 'zod';

import {
  BUSINESS_PLAN_SECTIONS,
  PILLAR_IDS,
  RUBRIC_DIMENSIONS,
  type BusinessPlanSectionKey,
  type PillarId,
} from './types.js';

// ─────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────

export const citationSchema = z
  .object({
    url: z.string().url(),
    title: z.string().min(1),
    fetchedAt: z.string().datetime().optional(),
    publishedAt: z.string().datetime().optional(),
    notes: z.string().optional(),
  })
  .strict();

export type Citation = z.infer<typeof citationSchema>;

export const sectionSchema = z
  .object({
    content: z.string(),
    confidence: z.number().min(0).max(100),
    decisionedAtTurn: z.number().int().nonnegative(),
    horizonDecomposition: z
      .object({
        mvp: z.array(z.string()).optional(),
        oneYear: z
          .array(
            z.object({
              item: z.string(),
              gatedOn: z.string().optional(),
            }),
          )
          .optional(),
        fiveYear: z.array(z.string()).optional(),
      })
      .optional(),
    structured: z.record(z.unknown()).optional(),
    rationale: z.array(z.string()).optional(),
    citations: z.array(citationSchema).optional(),
    operatorNotes: z.array(z.string()).optional(),
    pillarsCovered: z.array(z.string()).optional(),
  })
  .passthrough();

export type Section = z.infer<typeof sectionSchema>;

// ─────────────────────────────────────────────────────────────────────────
// Open unknowns / operator log / critic
// ─────────────────────────────────────────────────────────────────────────

export const openUnknownSchema = z
  .object({
    pillar: z.string(),
    question_id: z.string(),
    question: z.string(),
    suggestedDefault: z.string().optional(),
    blocking: z.boolean(),
    reason: z.enum([
      'founder_doesnt_know',
      'deferred_3x',
      'rubric_clamp',
      'operator_force_close',
    ]),
  })
  .strict();

export const operatorDecisionEntrySchema = z
  .object({
    turn: z.number().int().nonnegative(),
    responderRole: z.enum(['founder', 'operator', 'customer']),
    decisionField: z.string(),
    from: z.string(),
    to: z.string(),
    rationale: z.string(),
  })
  .strict();

export const rubricScoresSchema = z
  .object({
    perPillarCoverage: z.record(z.string(), z.number().min(0).max(100)),
    dimensions: z.object(
      RUBRIC_DIMENSIONS.reduce(
        (acc, d) => {
          acc[d] = z.number().min(1).max(5);
          return acc;
        },
        {} as Record<(typeof RUBRIC_DIMENSIONS)[number], z.ZodNumber>,
      ),
    ),
    aggregateScore: z.number().min(0).max(100),
  })
  .strict();

export const criticPassSchema = z
  .object({
    recommendation: z.enum(['meeting', 'pass_kind', 'pass_no_note']),
    top5DecisionFactors: z.array(
      z
        .object({
          factor: z.string(),
          quote: z.string(),
          sentiment: z.enum(['positive', 'negative']),
        })
        .strict(),
    ),
    meetingQuestions: z.array(z.string()),
    blockers: z.array(
      z
        .object({
          issue: z.string(),
          planSection: z.string(),
          severity: z.enum(['blocker', 'major', 'minor']),
        })
        .strict(),
    ),
    ranAtTurn: z.number().int().nonnegative(),
    passNumber: z.union([z.literal(1), z.literal(2)]),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────
// BusinessPlanV2 top-level
// ─────────────────────────────────────────────────────────────────────────

function buildSectionsShape(): Record<BusinessPlanSectionKey, typeof sectionSchema> {
  const out = {} as Record<BusinessPlanSectionKey, typeof sectionSchema>;
  for (const key of BUSINESS_PLAN_SECTIONS) {
    out[key] = sectionSchema;
  }
  return out;
}

export const businessPlanV2Schema = z
  .object({
    schemaVersion: z.literal('2.0.0'),
    interviewId: z.string().uuid(),
    operatorEmail: z.string().email(),
    createdAt: z.string().datetime(),
    lastUpdatedAt: z.string().datetime(),

    ...buildSectionsShape(),

    openUnknowns: z.array(openUnknownSchema),
    rubricScores: rubricScoresSchema,
    criticPass: criticPassSchema.optional(),
    operatorDecisionsLog: z.array(operatorDecisionEntrySchema),
  })
  .passthrough();

export type BusinessPlanV2 = z.infer<typeof businessPlanV2Schema>;

// ─────────────────────────────────────────────────────────────────────────
// Factory: empty plan skeleton
// ─────────────────────────────────────────────────────────────────────────

export interface EmptyPlanInput {
  readonly interviewId: string;
  readonly operatorEmail: string;
  readonly createdAt?: Date;
}

const EMPTY_PILLAR_COVERAGE: Record<PillarId, number> = PILLAR_IDS.reduce(
  (acc, pid) => {
    acc[pid] = 0;
    return acc;
  },
  {} as Record<PillarId, number>,
);

const EMPTY_DIMENSIONS = RUBRIC_DIMENSIONS.reduce(
  (acc, d) => {
    acc[d] = 1;
    return acc;
  },
  {} as Record<(typeof RUBRIC_DIMENSIONS)[number], number>,
);

const EMPTY_SECTION: Section = Object.freeze({
  content: '',
  confidence: 0,
  decisionedAtTurn: 0,
  pillarsCovered: [],
}) as unknown as Section;

export function emptyBusinessPlan(input: EmptyPlanInput): BusinessPlanV2 {
  const now = (input.createdAt ?? new Date()).toISOString();
  const sections: Record<string, Section> = {};
  for (const key of BUSINESS_PLAN_SECTIONS) {
    sections[key] = { ...EMPTY_SECTION, pillarsCovered: [] };
  }
  const plan: BusinessPlanV2 = {
    schemaVersion: '2.0.0',
    interviewId: input.interviewId,
    operatorEmail: input.operatorEmail,
    createdAt: now,
    lastUpdatedAt: now,
    ...(sections as Record<BusinessPlanSectionKey, Section>),
    openUnknowns: [],
    rubricScores: {
      perPillarCoverage: { ...EMPTY_PILLAR_COVERAGE },
      dimensions: { ...EMPTY_DIMENSIONS },
      aggregateScore: 0,
    },
    operatorDecisionsLog: [],
  } as BusinessPlanV2;
  return plan;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

export function getSection(plan: BusinessPlanV2, key: BusinessPlanSectionKey): Section {
  return (plan as unknown as Record<BusinessPlanSectionKey, Section>)[key];
}

export function setSection(
  plan: BusinessPlanV2,
  key: BusinessPlanSectionKey,
  section: Section,
): BusinessPlanV2 {
  return {
    ...plan,
    [key]: section,
    lastUpdatedAt: new Date().toISOString(),
  } as BusinessPlanV2;
}

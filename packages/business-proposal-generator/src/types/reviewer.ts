/**
 * Prompt Reviewer types (spec §4).
 */

import { z } from 'zod';

export const REVIEWER_DIMENSIONS = [
  'coverage',
  'specificity',
  'target_fit',
  'creativity_surface',
  'no_drift',
  'polish',
] as const;

export type ReviewerDimension = (typeof REVIEWER_DIMENSIONS)[number];

/** Rubric weights — must sum to 1.0. */
export const REVIEWER_WEIGHTS: Readonly<Record<ReviewerDimension, number>> = Object.freeze({
  coverage: 0.25,
  specificity: 0.2,
  target_fit: 0.2,
  creativity_surface: 0.15,
  no_drift: 0.1,
  polish: 0.1,
});

export const REVIEWER_SHIP_THRESHOLD = 70;

export const reviewerFindingSchema = z.object({
  severity: z.enum(['high', 'medium', 'low']),
  dimension: z.enum(REVIEWER_DIMENSIONS),
  message: z.string().min(1),
  suggested_fix: z.string().optional(),
});

export const reviewerOutputSchema = z.object({
  composite_score: z.number().min(0).max(100),
  dimensions: z.object({
    coverage: z.number().min(0).max(100),
    specificity: z.number().min(0).max(100),
    target_fit: z.number().min(0).max(100),
    creativity_surface: z.number().min(0).max(100),
    no_drift: z.number().min(0).max(100),
    polish: z.number().min(0).max(100),
  }),
  findings: z.array(reviewerFindingSchema).default([]),
  recommendation: z.enum(['ship', 'retry', 'escalate']),
});

export type ReviewerFinding = z.infer<typeof reviewerFindingSchema>;
export type ReviewerOutput = z.infer<typeof reviewerOutputSchema>;

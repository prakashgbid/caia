/**
 * Smart CI/CD Agent — types (Zod schemas + inferred TS types).
 *
 * Reference: caia-ai-tech-modernization-proposal-2026-04-30.md §6A.5.
 *
 * Daily-cycle schema:
 *   1. AGGREGATE → bucketed counts of pre-existing failure classes from the last 24h.
 *   2. CLASSIFY  → for each bucket > N, classify dominant root cause (LLM, xgrammar-constrained JSON).
 *   3. PROPOSE   → emit a typed ProposedAction per root cause.
 *   4. ACT       → propose-only: open auto-fix PR, file rec issue, write prompts-registry candidate, etc.
 *
 * **Hard invariant:** the Smart CI/CD Agent is propose-only. It NEVER auto-merges PRs,
 * deletes branches, force-pushes, or merges without an operator.
 */

import { z } from 'zod';

export const SMART_CICD = 'v0.1.0';

/* ───────────────────────────────────────────────────────────────────────── *
 *  Failure-mode buckets (the inputs to classification)                      *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Stable bucket name keys for daily aggregation.
 * Each key counts the number of distinct PR/CI events in the last 24h that
 * matched the bucket's deterministic predicate.
 */
export const BucketName = z.enum([
  'lint_failures',
  'typecheck_failures',
  'test_flakes',
  'validator_section_x_failures',
  'fix_it_loop_exhausted',
  'merge_conflicts',
  'pre_commit_blocked',
  'stale_branch_warnings',
  'gitflow_conformance_violations',
  'pipeline_regression_failures',
  // Steward-emitted buckets (process-graph drifts; see @chiefaia/steward-core).
  // Reference: ~/Documents/projects/reports/devops-steward-agent-design-2026-05-03.md §3.1.
  'steward_post_release_back_merge_drift',
  'steward_back_merge_stuck_drift',
]);
export type BucketName = z.infer<typeof BucketName>;

/**
 * One bucket's daily count + an opaque list of exemplar event references
 * (PR numbers, CI run IDs, fix-it loop IDs, …).
 */
export const FailureBucket = z.object({
  bucketName: BucketName,
  count: z.number().int().nonnegative(),
  exemplarRefs: z.array(z.string()).max(20),
});
export type FailureBucket = z.infer<typeof FailureBucket>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Classification (LLM step)                                                *
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * Stable root-cause vocabulary. Defined explicitly so the LLM is constrained
 * via xgrammar to one of these strings.
 */
export const RootCause = z.enum([
  'code-style-drift',
  'new-test-flake',
  'validator-threshold-drift',
  'fix-it-loop-prompt-regression',
  'merge-conflict-policy-gap',
  'contributor-onboarding-gap',
  'deferred-work-archive-candidate',
  'gitflow-policy-gap',
  'pipeline-rule-mis-fire',
  'unknown',
]);
export type RootCause = z.infer<typeof RootCause>;

/**
 * Output of step 2 (classify). Bucket → root cause + confidence.
 */
export const Classification = z.object({
  bucketName: BucketName,
  rootCause: RootCause,
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});
export type Classification = z.infer<typeof Classification>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Proposals (the propose-only act step)                                    *
 * ───────────────────────────────────────────────────────────────────────── */

export const ProposedActionKind = z.enum([
  'auto-fix-pr',
  'rec-issue',
  'prompt-update',
  'skill-bump',
  'silent',
]);
export type ProposedActionKind = z.infer<typeof ProposedActionKind>;

const AutoFixPrPayload = z.object({
  kind: z.literal('auto-fix-pr'),
  branchName: z.string().regex(/^smart-cicd\/auto-fix-/),
  baseBranch: z.literal('develop'),
  title: z.string().min(1).max(80),
  body: z.string().max(4000),
  files: z
    .array(
      z.object({
        path: z.string().min(1),
        contents: z.string(),
      })
    )
    .min(1)
    .max(10),
});

const RecIssuePayload = z.object({
  kind: z.literal('rec-issue'),
  title: z.string().min(1).max(80),
  body: z.string().max(8000),
  labels: z.array(z.string()).max(8),
});

const PromptUpdatePayload = z.object({
  kind: z.literal('prompt-update'),
  promptKey: z.string().min(1),
  draftPromptText: z.string().min(1),
  evidenceTraceIds: z.array(z.string()).min(1).max(50),
  expectedDeltaPct: z.number().min(-100).max(100),
});

const SkillBumpPayload = z.object({
  kind: z.literal('skill-bump'),
  skillName: z.string().min(1),
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  rationale: z.string().min(1).max(2000),
});

const SilentPayload = z.object({
  kind: z.literal('silent'),
  note: z.string().max(500),
});

export const ProposedActionPayload = z.discriminatedUnion('kind', [
  AutoFixPrPayload,
  RecIssuePayload,
  PromptUpdatePayload,
  SkillBumpPayload,
  SilentPayload,
]);
export type ProposedActionPayload = z.infer<typeof ProposedActionPayload>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Outcome + feedback (the audit trail)                                     *
 * ───────────────────────────────────────────────────────────────────────── */

export const ActedOutcome = z.enum([
  'merged',
  'rejected',
  'still-open',
  'silent',
]);
export type ActedOutcome = z.infer<typeof ActedOutcome>;

export const FeedbackLabel = z.enum(['accepted', 'rejected', 'pending']);
export type FeedbackLabel = z.infer<typeof FeedbackLabel>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  The full observation row (mirrors migration 0052)                        *
 * ───────────────────────────────────────────────────────────────────────── */

export const Observation = z.object({
  id: z.string().min(1),
  observationDate: z.number().int().positive(),
  bucketName: BucketName,
  rootCause: RootCause,
  rootCauseConfidence: z.number().min(0).max(1),
  proposedActionKind: ProposedActionKind,
  proposedActionPayload: ProposedActionPayload,
  actedAt: z.number().int().positive().nullable(),
  actedOutcome: ActedOutcome.nullable(),
  feedbackLabel: FeedbackLabel.nullable(),
  createdAt: z.number().int().positive(),
});
export type Observation = z.infer<typeof Observation>;

/* ───────────────────────────────────────────────────────────────────────── *
 *  Daily-cycle wrapper (the daemon's report shape)                          *
 * ───────────────────────────────────────────────────────────────────────── */

export const DailyCycleReport = z.object({
  windowStartAt: z.number().int().positive(),
  windowEndAt: z.number().int().positive(),
  buckets: z.array(FailureBucket),
  classifications: z.array(Classification),
  observations: z.array(Observation),
});
export type DailyCycleReport = z.infer<typeof DailyCycleReport>;

/**
 * MECE judge pair (proposal §5F).
 *
 * After every parent expansion, two judges run in parallel:
 *
 *   1. Parent-coverage judge — does the union of children fully cover
 *      the parent's inScope? (PMBOK 100% rule.)
 *   2. Sibling-disjointness judge — do any two children overlap in
 *      deliverable scope? (MECE-mutually-exclusive.)
 *
 * Both judges return a 1-5 score. The pass threshold is 4.0; on
 * either fail the engine kicks off reflexive retry: the decomposer
 * is re-invoked with the judge's rejection rationale appended to the
 * user prompt as Reflexion-style feedback. Up to 2 retries.
 *
 * Both judges route through `po-decomposer-coverage-judge` /
 * `po-decomposer-disjointness-judge` task types (Sonnet) — judging is
 * high-leverage low-cost relative to regenerating downstream artefacts.
 */

import { z } from 'zod';
import { callStructured } from './structured-output.js';
import type { CancellationSignal, ChildTicket, StoryScope } from './types.js';

export const COVERAGE_JUDGE_TASK_TYPE = 'po-decomposer-coverage-judge';
export const DISJOINTNESS_JUDGE_TASK_TYPE = 'po-decomposer-disjointness-judge';

/**
 * Pass threshold for both judges. 4.0 / 5.0 means the model must
 * agree fairly strongly that the children cover (resp. are disjoint).
 * Below this, the engine reflexively retries the parent expansion.
 */
export const JUDGE_PASS_THRESHOLD = 4.0;

// ─── Schemas ────────────────────────────────────────────────────────────

const CoverageJudgeOutputSchema = z.object({
  /** 1..5 confidence the children fully cover the parent. */
  score: z.number().min(1).max(5),
  /** True iff score >= JUDGE_PASS_THRESHOLD. */
  covered: z.boolean(),
  /** Verbatim deliverables the judge thinks are missing. */
  missingDeliverables: z.array(z.string()),
  /** Free-form one-paragraph rationale (used as reflexive feedback). */
  rationale: z.string().min(5),
});

const DisjointnessJudgeOutputSchema = z.object({
  score: z.number().min(1).max(5),
  disjoint: z.boolean(),
  /** Pairs of overlapping siblings (verbatim ids + a one-line description). */
  overlaps: z.array(
    z.object({
      childA: z.string().min(1),
      childB: z.string().min(1),
      overlapDescription: z.string().min(3),
    }),
  ),
  rationale: z.string().min(5),
});

// ─── Inputs / outputs ───────────────────────────────────────────────────

export interface JudgeInput {
  /** Parent ticket — judges see this to scope coverage. */
  parent: {
    title: string;
    description: string;
    scope: StoryScope;
    inScope: string[];
    outOfScope: string[];
  };
  /** Children produced by the decomposer. */
  children: ChildTicket[];
  /** Optional cancellation signal. */
  signal?: CancellationSignal;
}

export interface CoverageVerdict {
  score: number; // 1..5
  passed: boolean; // score >= threshold
  missingDeliverables: string[];
  rationale: string;
  model: string;
  durationMs: number;
  costUsd: number;
}

export interface DisjointnessVerdict {
  score: number; // 1..5
  passed: boolean;
  overlaps: Array<{ childA: string; childB: string; overlapDescription: string }>;
  rationale: string;
  model: string;
  durationMs: number;
  costUsd: number;
}

export interface JudgePairResult {
  coverage: CoverageVerdict;
  disjointness: DisjointnessVerdict;
  /** True iff BOTH judges passed. */
  bothPassed: boolean;
  /**
   * Combined feedback the decomposer can inject as a system message
   * on the next reflexive retry. Empty string when both judges pass.
   */
  reflexiveFeedback: string;
}

// ─── System prompts ─────────────────────────────────────────────────────

const COVERAGE_JUDGE_SYSTEM_PROMPT = `You are evaluating a Work Breakdown Structure (WBS) for the PMBOK 100% rule.

The 100% rule states: the children must cover 100% of the work implied by the parent's inScope. Anything intentionally omitted must be in the parent's outOfScope.

Score 1..5 (5 = perfect coverage; 4 = minor gaps acceptable; 3 = noticeable gaps; 2 = significant gaps; 1 = major coverage failure). Set "covered": true when score >= 4.0.

List every concrete deliverable from the parent's inScope that is NOT addressed by any child as "missingDeliverables". If "covered" is true and "missingDeliverables" non-empty, you have an internal contradiction — re-evaluate.

Output schema:
{
  "score": 1..5,
  "covered": true | false,
  "missingDeliverables": [ "verbatim deliverable text" ],
  "rationale": "one paragraph"
}`;

const DISJOINTNESS_JUDGE_SYSTEM_PROMPT = `You are evaluating a Work Breakdown Structure (WBS) for the MECE-mutually-exclusive principle.

Children must NOT overlap in deliverable scope. If two children describe the same feature/component/data-store, they overlap — list them in "overlaps".

Score 1..5 (5 = no overlaps; 4 = minor overlap on edge cases; 3 = noticeable overlap; 2 = significant overlap; 1 = severe overlap throughout). Set "disjoint": true when score >= 4.0.

For each overlapping pair, include both child IDs (verbatim from the children list) and a one-line description of the overlap.

Output schema:
{
  "score": 1..5,
  "disjoint": true | false,
  "overlaps": [
    { "childA": "id1", "childB": "id2", "overlapDescription": "..." }
  ],
  "rationale": "one paragraph"
}`;

// ─── Helpers ────────────────────────────────────────────────────────────

function buildUserPrompt(input: JudgeInput): string {
  const childrenBlock = input.children
    .map(
      (c, i) =>
        `### Child ${String(i + 1)} (id=${c.id}, scope=${c.scope})\n` +
        `Title: ${c.title}\n` +
        `Description: ${c.description}\n` +
        `In scope: ${c.inScope.join('; ') || '(empty)'}\n` +
        `Out of scope: ${c.outOfScope.join('; ') || '(empty)'}`,
    )
    .join('\n\n');

  return [
    `## PARENT`,
    `Title: ${input.parent.title}`,
    `Scope: ${input.parent.scope}`,
    `Description: ${input.parent.description}`,
    `In scope: ${input.parent.inScope.join('; ') || '(empty)'}`,
    `Out of scope: ${input.parent.outOfScope.join('; ') || '(empty)'}`,
    '',
    `## CHILDREN (${String(input.children.length)})`,
    childrenBlock,
  ].join('\n');
}

function formatCoverageFeedback(v: CoverageVerdict): string {
  if (v.passed) return '';
  const missingBullets =
    v.missingDeliverables.length > 0
      ? v.missingDeliverables.map((m) => ` - ${m}`).join('\n')
      : ' - (none listed by judge — see rationale)';
  return (
    `### Coverage judge — FAIL (score ${v.score.toFixed(2)} < ${JUDGE_PASS_THRESHOLD.toFixed(1)})\n` +
    `Missing deliverables:\n${missingBullets}\n` +
    `Rationale: ${v.rationale}`
  );
}

function formatDisjointnessFeedback(v: DisjointnessVerdict): string {
  if (v.passed) return '';
  const overlapsBullets =
    v.overlaps.length > 0
      ? v.overlaps
          .map(
            (o) =>
              ` - ${o.childA} <-> ${o.childB}: ${o.overlapDescription}`,
          )
          .join('\n')
      : ' - (none listed by judge — see rationale)';
  return (
    `### Disjointness judge — FAIL (score ${v.score.toFixed(2)} < ${JUDGE_PASS_THRESHOLD.toFixed(1)})\n` +
    `Overlapping siblings:\n${overlapsBullets}\n` +
    `Rationale: ${v.rationale}`
  );
}

// ─── Public API ────────────────────────────────────────────────────────

/**
 * Run both judges in parallel. Returns the verdicts, a `bothPassed`
 * flag, and a combined `reflexiveFeedback` string the engine can
 * inject as Reflexion-style feedback on the next decomposer retry.
 */
export async function runJudgePair(input: JudgeInput): Promise<JudgePairResult> {
  const userPrompt = buildUserPrompt(input);

  const [coverageResult, disjointnessResult] = await Promise.all([
    callStructured(CoverageJudgeOutputSchema, {
      taskType: COVERAGE_JUDGE_TASK_TYPE,
      systemPrompt: COVERAGE_JUDGE_SYSTEM_PROMPT,
      userPrompt,
      maxRetries: 2,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
    callStructured(DisjointnessJudgeOutputSchema, {
      taskType: DISJOINTNESS_JUDGE_TASK_TYPE,
      systemPrompt: DISJOINTNESS_JUDGE_SYSTEM_PROMPT,
      userPrompt,
      maxRetries: 2,
      ...(input.signal ? { signal: input.signal } : {}),
    }),
  ]);

  // Force-correct contradictions: if score >= threshold but the
  // boolean disagrees, override the boolean. Bias toward "fail" when
  // missingDeliverables / overlaps is non-empty (conservative).
  let coveragePassed = coverageResult.data.score >= JUDGE_PASS_THRESHOLD;
  if (coveragePassed && coverageResult.data.missingDeliverables.length > 0) {
    coveragePassed = false;
  }
  let disjointnessPassed = disjointnessResult.data.score >= JUDGE_PASS_THRESHOLD;
  if (disjointnessPassed && disjointnessResult.data.overlaps.length > 0) {
    disjointnessPassed = false;
  }

  const coverage: CoverageVerdict = {
    score: coverageResult.data.score,
    passed: coveragePassed,
    missingDeliverables: coverageResult.data.missingDeliverables,
    rationale: coverageResult.data.rationale,
    model: coverageResult.model,
    durationMs: coverageResult.durationMs,
    costUsd: coverageResult.costUsd,
  };
  const disjointness: DisjointnessVerdict = {
    score: disjointnessResult.data.score,
    passed: disjointnessPassed,
    overlaps: disjointnessResult.data.overlaps,
    rationale: disjointnessResult.data.rationale,
    model: disjointnessResult.model,
    durationMs: disjointnessResult.durationMs,
    costUsd: disjointnessResult.costUsd,
  };

  const bothPassed = coverage.passed && disjointness.passed;
  const reflexiveFeedback = bothPassed
    ? ''
    : [
        '## JUDGE FEEDBACK FROM PRIOR ATTEMPT',
        formatCoverageFeedback(coverage),
        formatDisjointnessFeedback(disjointness),
        '',
        'Re-decompose the parent addressing every issue above. Cover the missing deliverables; merge or disambiguate the overlapping siblings.',
      ]
        .filter((s) => s.length > 0)
        .join('\n\n');

  return { coverage, disjointness, bothPassed, reflexiveFeedback };
}

/**
 * Normalise a 1..5 judge score to a 0..1 confidence range that fits
 * the AuditEntry / Decomposition schema's `coverageScore` /
 * `disjointnessScore` field.
 */
export function normaliseJudgeScore(scoreOneToFive: number): number {
  // (s - 1) / 4 maps 1..5 → 0..1.
  return Math.max(0, Math.min(1, (scoreOneToFive - 1) / 4));
}

/** Prompt Reviewer subagent — six-dimension rubric, one LLM call. */

import { ProposalGeneratorError } from '../errors.js';
import { extractJsonObject, type LlmCaller } from '../llm.js';
import type { IaArtifactSet } from '../types/ia.js';
import type { BusinessPlanV2, TargetName } from '../types/proposal.js';
import type { DesignAppPromptOutput } from '../types/design-app.js';
import { REVIEWER_SHIP_THRESHOLD, reviewerOutputSchema, type ReviewerOutput } from '../types/reviewer.js';
import { computeComposite, type DimensionScores } from './rubric.js';

export interface ReviewPromptInput {
  llmCaller: LlmCaller;
  plan: BusinessPlanV2;
  ia: IaArtifactSet;
  envelope: DesignAppPromptOutput;
  target: TargetName;
  /** Optional skill body for "expected intake style" context. */
  skillBody?: string;
}

export async function reviewPrompt(input: ReviewPromptInput): Promise<ReviewerOutput> {
  const sys = `You are the CAIA Prompt Reviewer. Score the generated design-app prompt on six dimensions (0-100 each):
- coverage (25%): every plan section represented
- specificity (20%): concrete where decisions were made; vague where not
- target_fit (20%): matches the target's expected intake style
- creativity_surface (15%): leaves room for design exploration where appropriate
- no_drift (10%): does not invent decisions not in the plan
- polish (10%): no placeholders, no dangling {{VARIABLE}}, no [TODO]

Return ONLY a JSON object: {composite_score, dimensions:{coverage,specificity,target_fit,creativity_surface,no_drift,polish}, findings:[{severity,dimension,message,suggested_fix}], recommendation:'ship'|'retry'|'escalate'}
recommendation = 'ship' if composite_score >= ${REVIEWER_SHIP_THRESHOLD}, else 'retry', or 'escalate' if the prompt is fundamentally broken.`;

  const user = [
    `## Target: ${input.target}`,
    input.skillBody ? `## Expected intake style (from SKILL.md)\n${input.skillBody.slice(0, 8000)}` : '',
    `## Generated prompt envelope`,
    JSON.stringify(input.envelope).slice(0, 30000),
    `## Business plan`,
    JSON.stringify(input.plan).slice(0, 20000),
    `## IA artifacts`,
    JSON.stringify(input.ia).slice(0, 10000),
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await input.llmCaller.call(user, {
    systemPrompt: sys,
    modelHint: 'sonnet',
    maxBudgetMs: 60_000,
  });
  if (!result.ok) {
    throw new ProposalGeneratorError(
      'reviewer_failed',
      'reviewer LLM call failed',
      undefined,
      { diagnostic: result.diagnostic },
    );
  }

  let raw: unknown;
  try {
    raw = extractJsonObject(result.text);
  } catch (err) {
    throw new ProposalGeneratorError('reviewer_failed', 'reviewer output not parseable JSON', err);
  }

  let parsed: ReviewerOutput;
  try {
    parsed = reviewerOutputSchema.parse(raw);
  } catch (err) {
    throw new ProposalGeneratorError('reviewer_failed', 'reviewer output failed schema', err);
  }

  // Trust-but-verify the composite: recompute from dimensions; if it
  // disagrees by more than 1 point, override with the recomputed value.
  const recomputed = computeComposite(parsed.dimensions as DimensionScores);
  if (Math.abs(recomputed - parsed.composite_score) > 1) {
    parsed = { ...parsed, composite_score: recomputed };
  }
  return parsed;
}

export function recommendationFromScore(score: number): 'ship' | 'retry' {
  return score >= REVIEWER_SHIP_THRESHOLD ? 'ship' : 'retry';
}

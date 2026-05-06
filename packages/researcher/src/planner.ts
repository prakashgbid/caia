/**
 * Planner stage — DESIGN.md §5 step 2.
 *
 * Decompose the operator's research query into N sub-questions that can be
 * answered with a small (5-12) batch of web sources each. The planner runs ONE
 * claude-binary subprocess call. Output is strict JSON; we extract the JSON
 * defensively in case the model adds prose around it.
 *
 * Precedent excerpts (from Librarian) are included so the planner can avoid
 * re-doing prior CAIA decisions ("we already evaluated X in 2026-03 and
 * decided Y; this query is a different angle on the same trade-off").
 */

import { extractFirstJsonBlock } from './llm-client.js';
import type {
  Depth,
  LlmClient,
  PrecedentInjection,
  ResearchPlan
} from './types.js';

export interface PlannerOptions {
  llm: LlmClient;
  model: string;
  timeoutMs: number;
}

export interface PlannerInput {
  query: string;
  depth: Depth;
  targetSubQuestions: number;
  precedent: readonly PrecedentInjection[];
}

const PLANNER_SYSTEM_PROMPT = `You are a research-planner agent. Your only job is to decompose the operator's research question into a small set of factually-investigable SUB-QUESTIONS that, taken together, fully answer the question. Each sub-question must be specific, web-searchable, and non-overlapping with the others.

Constraints:
- Sub-questions must be FACTUAL (what is X, how does Y work, who has done Z) — not opinion.
- Each sub-question should be answerable with 5-12 web sources.
- Avoid restating the original question; aim for orthogonal axes (capabilities, alternatives, fit, risks, ecosystem maturity, costs, prior precedent).
- Strictly avoid sub-questions whose answer is already settled by the precedent excerpts — note them as "covered by precedent" instead.

Output STRICT JSON in this exact shape:
{"subQuestions":["...","...","..."],"rationale":"<one short paragraph>","coveredByPrecedent":["..."]}
No prose before or after. No markdown fences.`;

export function buildPlannerPrompt(input: PlannerInput): string {
  const precedentBlock =
    input.precedent.length === 0
      ? '(no precedent retrieved)'
      : input.precedent
          .map(
            p =>
              `- ${p.slug} (similarity ${p.similarity.toFixed(2)})\n  ${p.excerpt.slice(0, 600)}`
          )
          .join('\n');
  return `${PLANNER_SYSTEM_PROMPT}

## Research query
${input.query}

## Depth
${input.depth} — produce ${input.targetSubQuestions} sub-questions.

## Prior CAIA precedent (from Librarian)
${precedentBlock}

## Output JSON now:`;
}

export interface ParsedPlannerOutput {
  ok: boolean;
  plan: ResearchPlan | null;
  diagnostic?: string;
}

export function parsePlannerOutput(
  raw: string,
  query: string,
  depth: Depth
): ParsedPlannerOutput {
  if (raw.trim().length === 0) {
    return { ok: false, plan: null, diagnostic: 'empty LLM output' };
  }
  const json = extractFirstJsonBlock(raw) ?? raw;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      plan: null,
      diagnostic: `JSON parse: ${(e as Error).message}`
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, plan: null, diagnostic: 'not an object' };
  }
  const obj = parsed as Record<string, unknown>;
  const subRaw = obj['subQuestions'];
  if (!Array.isArray(subRaw)) {
    return { ok: false, plan: null, diagnostic: 'subQuestions not array' };
  }
  const subQuestions: string[] = subRaw
    .filter((q): q is string => typeof q === 'string')
    .map(q => q.trim())
    .filter(q => q.length > 0);
  if (subQuestions.length === 0) {
    return { ok: false, plan: null, diagnostic: 'no valid sub-questions' };
  }
  const rationale =
    typeof obj['rationale'] === 'string'
      ? (obj['rationale'] as string)
      : '(planner did not provide rationale)';
  return {
    ok: true,
    plan: { query, depth, subQuestions, rationale }
  };
}

/**
 * Planner stage entry point. Returns the plan, or a fallback plan derived
 * mechanically from the query when the LLM call fails.
 */
export async function planResearch(
  input: PlannerInput,
  opts: PlannerOptions
): Promise<ResearchPlan> {
  const prompt = buildPlannerPrompt(input);
  const completion = await opts.llm.complete({
    prompt,
    timeoutMs: opts.timeoutMs,
    model: opts.model
  });
  if (!completion.ok) {
    return fallbackPlan(input);
  }
  const parsed = parsePlannerOutput(completion.text, input.query, input.depth);
  if (!parsed.ok || parsed.plan === null) {
    return fallbackPlan(input);
  }
  // Cap to target count so the executor doesn't run more sub-Qs than the
  // depth tier allows.
  const sliced = parsed.plan.subQuestions.slice(0, input.targetSubQuestions);
  return { ...parsed.plan, subQuestions: sliced };
}

/**
 * Mechanical fallback: produce a generic decomposition from the query alone.
 * Activated when the LLM call fails (timeout, parse error). Lets the rest of
 * the pipeline still produce something useful instead of dying outright.
 */
export function fallbackPlan(input: PlannerInput): ResearchPlan {
  const q = input.query.trim();
  const subQuestions: string[] = [
    `What is ${q}? (definition, scope, who builds it)`,
    `What are the main alternatives to or competitors of ${q}?`,
    `What are documented production deployments of ${q} and their outcomes?`,
    `What are the documented risks, limitations, and failure modes of ${q}?`,
    `How does ${q} integrate with TypeScript, Node.js, and Hono microservices?`,
    `What does the academic / research literature on ${q} report?`,
    `What is the cost / licensing / sustainability profile of ${q}?`,
    `How has ${q} evolved over the last 12-24 months and what is its trajectory?`
  ];
  return {
    query: input.query,
    depth: input.depth,
    subQuestions: subQuestions.slice(0, input.targetSubQuestions),
    rationale:
      'fallback decomposition — LLM planner unavailable; using generic axes'
  };
}

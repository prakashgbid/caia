/**
 * Synthesizer stage — DESIGN.md §5 step 4.
 *
 * Spawns the second (and only other) claude-binary subprocess call. The
 * prompt carries:
 *   1. The system prompt (research-synthesis instructions + copyright + format).
 *   2. The original query + sub-questions + planner rationale.
 *   3. Precedent excerpts from Librarian.
 *   4. Per-source numbered excerpts from the executor's fetched corpus.
 *   5. The strict JSON output schema.
 *
 * Output is parsed defensively — we extract the first balanced JSON object
 * even if the LLM adds prose around it. If parsing fails, the synthesizer
 * returns ok=false and the caller decides to retry or surface the error.
 *
 * Source IDs in the prompt are stable, deterministic, and scoped to the
 * investigation: `s1, s2, s3, ...`. The synthesis prompt instructs the LLM
 * to cite ONLY using those IDs (e.g., `[^s3]`); the verifier later intersects
 * the LLM's citation set with the actual source set and drops phantoms.
 */

import { extractFirstJsonBlock } from './llm-client.js';
import type {
  FetchedPage,
  LlmClient,
  PrecedentInjection,
  RawSynthesis,
  ResearchPlan,
  ResearchSection
} from './types.js';

export interface SynthesizerOptions {
  llm: LlmClient;
  model: string;
  timeoutMs: number;
  maxQuoteWords: number;
  maxFetchedExcerptBytes: number;
}

export interface SynthesizerInput {
  plan: ResearchPlan;
  fetched: readonly FetchedPage[];
  precedent: readonly PrecedentInjection[];
}

export interface SynthesizerOutput {
  ok: boolean;
  raw: RawSynthesis | null;
  /** Map sourceId → fetched-page text excerpt actually shown to the LLM.
   *  Used by the verifier's hallucination guard. */
  shownExcerpts: Map<string, string>;
  /** Map sourceId → FetchedPage. Stable across the report. */
  sourceIdMap: Map<string, FetchedPage>;
  diagnostic?: string;
  /** Rough token estimate of the prompt (for cost telemetry). */
  promptTokenEstimate: number;
}

const SYSTEM_PROMPT = `You are a research-synthesis agent. Your job: produce a structured technology-evaluation report from the provided sources.

**MANDATORY RULES**:

1. CITE EVERY NON-TRIVIAL CLAIM using [^sN] footnote markers, where sN matches a source ID listed in the input. Do NOT invent source IDs.
2. PARAPHRASE BY DEFAULT. Direct quotes are allowed only sparingly: each quote MUST be ≤14 words AND in quotation marks AND attributed to a [^sN] source. Never reproduce ≥30 consecutive words verbatim from any source.
3. Weight PRIMARY sources (vendor docs, arxiv, official repos) higher than SECONDARY (engineering blogs) higher than TERTIARY (aggregators).
4. Be EVENHANDED: surface trade-offs, name the strongest counter-argument to your recommendation, and acknowledge uncertainty.
5. Use prior CAIA precedent to inform but not constrain the recommendation.
6. Return STRICT JSON in the exact schema below. No prose outside the JSON. No markdown fences.

**OUTPUT JSON SCHEMA**:

{
  "executiveSummary": "<≤500 words; bottom-line + top findings>",
  "recommendation": {
    "verdict": "adopt" | "pilot" | "track" | "reject",
    "confidence": "low" | "medium" | "high",
    "rationale": "<one paragraph>",
    "nextSteps": ["...", "..."]
  },
  "sections": [
    {"heading": "Landscape", "body": "<markdown body, cites [^sN]>"},
    {"heading": "Alternatives", "body": "<...>"},
    {"heading": "Fit assessment", "body": "<...>"},
    {"heading": "Risks and counter-arguments", "body": "<...>"}
  ],
  "citedSourceIds": ["s1","s3","s7"]
}`;

/** Rough token estimate: ~1 token per 4 characters. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function assignSourceIds(
  fetched: readonly FetchedPage[]
): Map<string, FetchedPage> {
  const map = new Map<string, FetchedPage>();
  fetched.forEach((p, i) => map.set(`s${i + 1}`, p));
  return map;
}

/** Build the synthesis prompt body. */
export function buildSynthesisPrompt(
  input: SynthesizerInput,
  sourceIdMap: Map<string, FetchedPage>,
  opts: SynthesizerOptions
): { prompt: string; shownExcerpts: Map<string, string> } {
  const precedentBlock =
    input.precedent.length === 0
      ? '(no precedent retrieved)'
      : input.precedent
          .map(
            p =>
              `- ${p.slug} (similarity ${p.similarity.toFixed(2)})\n  ${p.excerpt.slice(0, 800)}`
          )
          .join('\n\n');

  const sourcesBlock: string[] = [];
  const shownExcerpts = new Map<string, string>();
  for (const [id, page] of sourceIdMap) {
    const excerpt = page.text.slice(0, opts.maxFetchedExcerptBytes);
    shownExcerpts.set(id, excerpt);
    sourcesBlock.push(
      `### [^${id}] ${page.title} (${page.trust})\nURL: ${page.url}\n\n${excerpt}`
    );
  }

  const subQuestionsBlock = input.plan.subQuestions
    .map((q, i) => `${i + 1}. ${q}`)
    .join('\n');

  const prompt = `${SYSTEM_PROMPT}

## Original query
${input.plan.query}

## Depth tier
${input.plan.depth}

## Sub-questions to cover
${subQuestionsBlock}

## Planner rationale
${input.plan.rationale}

## Prior CAIA precedent (use to inform; do not let constrain)
${precedentBlock}

## Sources (cite ONLY these IDs; quote ≤${opts.maxQuoteWords} words)
${sourcesBlock.join('\n\n')}

## Output JSON now:`;

  return { prompt, shownExcerpts };
}

export function parseRawSynthesis(text: string): {
  ok: boolean;
  raw: RawSynthesis | null;
  diagnostic?: string;
} {
  if (text.trim().length === 0) {
    return { ok: false, raw: null, diagnostic: 'empty synthesizer output' };
  }
  const json = extractFirstJsonBlock(text) ?? text;
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return {
      ok: false,
      raw: null,
      diagnostic: `JSON parse: ${(e as Error).message}`
    };
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { ok: false, raw: null, diagnostic: 'not an object' };
  }
  const obj = parsed as Record<string, unknown>;
  const exec = obj['executiveSummary'];
  const rec = obj['recommendation'];
  const secs = obj['sections'];
  if (typeof exec !== 'string') {
    return {
      ok: false,
      raw: null,
      diagnostic: 'executiveSummary missing or not string'
    };
  }
  if (typeof rec !== 'object' || rec === null) {
    return {
      ok: false,
      raw: null,
      diagnostic: 'recommendation missing or not object'
    };
  }
  if (!Array.isArray(secs)) {
    return {
      ok: false,
      raw: null,
      diagnostic: 'sections missing or not array'
    };
  }
  const recObj = rec as Record<string, unknown>;
  const verdict = recObj['verdict'];
  const confidence = recObj['confidence'];
  const rationale = recObj['rationale'];
  const nextSteps = recObj['nextSteps'];
  if (
    verdict !== 'adopt' &&
    verdict !== 'pilot' &&
    verdict !== 'track' &&
    verdict !== 'reject'
  ) {
    return { ok: false, raw: null, diagnostic: 'recommendation.verdict invalid' };
  }
  if (
    confidence !== 'low' &&
    confidence !== 'medium' &&
    confidence !== 'high'
  ) {
    return {
      ok: false,
      raw: null,
      diagnostic: 'recommendation.confidence invalid'
    };
  }
  const sections: ResearchSection[] = secs
    .filter(
      (s): s is { heading: string; body: string } =>
        typeof s === 'object' &&
        s !== null &&
        typeof (s as { heading: unknown }).heading === 'string' &&
        typeof (s as { body: unknown }).body === 'string'
    )
    .map(s => ({ heading: s.heading, body: s.body }));
  if (sections.length === 0) {
    return { ok: false, raw: null, diagnostic: 'sections array empty' };
  }
  const citedRaw = obj['citedSourceIds'];
  const citedSourceIds: string[] = Array.isArray(citedRaw)
    ? citedRaw.filter((c): c is string => typeof c === 'string')
    : [];

  const raw: RawSynthesis = {
    executiveSummary: exec,
    recommendation: {
      verdict,
      confidence,
      rationale: typeof rationale === 'string' ? rationale : '',
      nextSteps: Array.isArray(nextSteps)
        ? nextSteps.filter((n): n is string => typeof n === 'string')
        : []
    },
    sections,
    citedSourceIds
  };
  return { ok: true, raw };
}

export async function runSynthesis(
  input: SynthesizerInput,
  opts: SynthesizerOptions
): Promise<SynthesizerOutput> {
  const sourceIdMap = assignSourceIds(input.fetched);
  const { prompt, shownExcerpts } = buildSynthesisPrompt(
    input,
    sourceIdMap,
    opts
  );
  const promptTokenEstimate = estimateTokens(prompt);
  const completion = await opts.llm.complete({
    prompt,
    timeoutMs: opts.timeoutMs,
    model: opts.model
  });
  if (!completion.ok) {
    return {
      ok: false,
      raw: null,
      shownExcerpts,
      sourceIdMap,
      diagnostic: completion.diagnostic ?? 'llm not ok',
      promptTokenEstimate
    };
  }
  const parsed = parseRawSynthesis(completion.text);
  if (!parsed.ok || parsed.raw === null) {
    return {
      ok: false,
      raw: null,
      shownExcerpts,
      sourceIdMap,
      diagnostic: parsed.diagnostic ?? 'parse failed',
      promptTokenEstimate
    };
  }
  return {
    ok: true,
    raw: parsed.raw,
    shownExcerpts,
    sourceIdMap,
    promptTokenEstimate
  };
}

/**
 * Verifier stage — DESIGN.md §5 step 5, §6, §7.
 *
 * Three guards run AFTER synthesis. The synthesizer cannot be trusted to honor
 * them — these are deterministic post-processing.
 *
 *   1. Hallucination guard: drop any [^sN] reference that isn't in the source
 *      ID map. Re-emit the body with phantom citations replaced by [^?]
 *      (a visible flag) and increment `hallucinationsDropped`.
 *
 *   2. Copyright guard: scan each section body for any verbatim run of
 *      ≥ (maxQuoteWords + 1) tokens that appears in any fetched source.
 *      Replace with `[...]` and increment `quotesScrubbed`.
 *
 *   3. Structure guard: enforce `minSourceCount` and section count. If
 *      violated, return ok=false; the agent decides whether to surface the
 *      error to the operator or retry once.
 *
 * Returns a `VerifierOutput` with the verified raw synthesis + diagnostics.
 */

import { scrubVerbatimRuns } from './ngram.js';
import type {
  FetchedPage,
  RawSynthesis,
  ResearchSection
} from './types.js';

const CITATION_RE = /\[\^([a-zA-Z0-9_]+)\]/g;

export interface VerifierOptions {
  maxQuoteWords: number;
  minSourceCount: number;
  hallucinationRatioThreshold: number;
}

export interface VerifierInput {
  raw: RawSynthesis;
  sourceIdMap: Map<string, FetchedPage>;
}

export interface VerifierOutput {
  ok: boolean;
  diagnostic?: string;
  /** Synthesis after hallucination + copyright scrubbing. */
  verified: RawSynthesis;
  /** Sources actually still cited after scrubbing. */
  retainedSourceIds: Set<string>;
  /** Counts for diagnostics. */
  quotesScrubbed: number;
  hallucinationsDropped: number;
}

export function verify(
  input: VerifierInput,
  opts: VerifierOptions
): VerifierOutput {
  const { raw, sourceIdMap } = input;
  let hallucinationsDropped = 0;
  const retainedSourceIds = new Set<string>();

  const scrubCitations = (body: string): string =>
    body.replace(CITATION_RE, (full, id) => {
      if (sourceIdMap.has(id)) {
        retainedSourceIds.add(id);
        return full;
      }
      hallucinationsDropped++;
      return '[^?]';
    });

  const sections: ResearchSection[] = raw.sections.map(s => ({
    heading: s.heading,
    body: scrubCitations(s.body)
  }));
  const executiveSummary = scrubCitations(raw.executiveSummary);
  const recommendationRationale = scrubCitations(raw.recommendation.rationale);

  // Copyright scrub.
  const sourceTexts: string[] = [];
  for (const p of sourceIdMap.values()) sourceTexts.push(p.text);

  let quotesScrubbed = 0;
  const scrubbedSections: ResearchSection[] = sections.map(s => {
    const r = scrubVerbatimRuns(s.body, sourceTexts, opts.maxQuoteWords + 1);
    quotesScrubbed += r.hits;
    return { heading: s.heading, body: r.scrubbed };
  });
  const scrubbedExec = scrubVerbatimRuns(
    executiveSummary,
    sourceTexts,
    opts.maxQuoteWords + 1
  );
  quotesScrubbed += scrubbedExec.hits;
  const scrubbedRationale = scrubVerbatimRuns(
    recommendationRationale,
    sourceTexts,
    opts.maxQuoteWords + 1
  );
  quotesScrubbed += scrubbedRationale.hits;

  // Hallucination ratio check.
  const totalCitations = countCitations(raw);
  const ratio =
    totalCitations === 0 ? 0 : hallucinationsDropped / totalCitations;
  const hallucinationOk = ratio <= opts.hallucinationRatioThreshold;

  const verified: RawSynthesis = {
    executiveSummary: scrubbedExec.scrubbed,
    recommendation: {
      verdict: raw.recommendation.verdict,
      confidence: raw.recommendation.confidence,
      rationale: scrubbedRationale.scrubbed,
      nextSteps: raw.recommendation.nextSteps
    },
    sections: scrubbedSections,
    citedSourceIds: Array.from(retainedSourceIds)
  };

  // Structure checks.
  if (sourceIdMap.size < opts.minSourceCount) {
    return {
      ok: false,
      diagnostic: `source count ${sourceIdMap.size} below floor ${opts.minSourceCount}`,
      verified,
      retainedSourceIds,
      quotesScrubbed,
      hallucinationsDropped
    };
  }
  if (!hallucinationOk) {
    return {
      ok: false,
      diagnostic: `hallucination ratio ${ratio.toFixed(2)} exceeds threshold ${opts.hallucinationRatioThreshold}`,
      verified,
      retainedSourceIds,
      quotesScrubbed,
      hallucinationsDropped
    };
  }
  if (verified.sections.length < 3) {
    return {
      ok: false,
      diagnostic: `section count ${verified.sections.length} below 3`,
      verified,
      retainedSourceIds,
      quotesScrubbed,
      hallucinationsDropped
    };
  }
  if (verified.executiveSummary.trim().length < 100) {
    return {
      ok: false,
      diagnostic: 'executive summary too short (<100 chars)',
      verified,
      retainedSourceIds,
      quotesScrubbed,
      hallucinationsDropped
    };
  }

  return {
    ok: true,
    verified,
    retainedSourceIds,
    quotesScrubbed,
    hallucinationsDropped
  };
}

/** Total [^x] tokens across the synthesised body. */
export function countCitations(raw: RawSynthesis): number {
  let n = 0;
  const count = (s: string): void => {
    const m = s.match(CITATION_RE);
    if (m !== null) n += m.length;
  };
  count(raw.executiveSummary);
  count(raw.recommendation.rationale);
  for (const sec of raw.sections) count(sec.body);
  return n;
}

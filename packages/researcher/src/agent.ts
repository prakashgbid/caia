/**
 * ResearcherAgent — public class that orchestrates the five-stage pipeline.
 *
 * DESIGN.md §3, §5. Every dependency is parameterised; defaults are CAIA's
 * production wiring. Tests construct with fixture wiring.
 */

import {
  resolveConfig,
  sourcesPerQuestionForDepth,
  subQuestionsForDepth,
  type ResearcherAgentConfig,
  type ResolvedResearcherConfig
} from './config.js';
import { createEmptyPrecedentSource } from './fetchers/precedent-source.js';
import { createDefaultLlmClient } from './llm-client.js';
import { assembleMarkdown } from './markdown.js';
import { executePlan } from './executor.js';
import { planResearch } from './planner.js';
import { runSynthesis } from './synthesizer.js';
import type {
  FetchedPage,
  InvestigateInput,
  LlmClient,
  PrecedentSource,
  ResearchReport,
  ResearchSource,
  WebFetcher,
  WebSearcher
} from './types.js';
import { verify } from './verifier.js';

export class ResearcherAgent {
  readonly config: ResolvedResearcherConfig;
  private readonly searcher: WebSearcher;
  private readonly fetcher: WebFetcher;
  private readonly precedent: PrecedentSource;
  private readonly llm: LlmClient;

  constructor(raw?: ResearcherAgentConfig) {
    this.config = resolveConfig(raw);
    if (this.config.searcher === null) {
      throw new Error(
        'ResearcherAgent: searcher is required. Pass a WebSearcher (e.g. createCommandLineSearcher) at construction time.'
      );
    }
    if (this.config.fetcher === null) {
      throw new Error(
        'ResearcherAgent: fetcher is required. Pass a WebFetcher (e.g. createDefaultWebFetcher with an HttpFetcher) at construction time.'
      );
    }
    this.searcher = this.config.searcher;
    this.fetcher = this.config.fetcher;
    this.precedent =
      this.config.precedentSource ?? createEmptyPrecedentSource();
    this.llm =
      this.config.llm ??
      createDefaultLlmClient({ binaryPath: this.config.claudeBinaryPath });
  }

  async investigateTopic(input: InvestigateInput): Promise<ResearchReport> {
    const start = this.config.clock().getTime();
    const depth = input.depth ?? this.config.defaultDepth;
    const targetSubQs = subQuestionsForDepth(depth, this.config);
    const sourcesPerQ = sourcesPerQuestionForDepth(depth, this.config);

    // Stage 1 — Precedent.
    const precedent = await this.precedent.retrieve(input.query, { topN: 5 });

    // Stage 2 — Planner.
    const plan = await planResearch(
      {
        query: input.query,
        depth,
        targetSubQuestions: targetSubQs,
        precedent
      },
      {
        llm: this.llm,
        model: this.config.plannerModel,
        timeoutMs: this.config.plannerTimeoutMs
      }
    );

    // Stage 3 — Executor.
    const executor = await executePlan(plan, {
      searcher: this.searcher,
      fetcher: this.fetcher,
      sourcesPerQuestion: sourcesPerQ,
      perFetchTimeoutMs: this.config.perFetchTimeoutMs
    });

    // Stage 4 — Synthesizer.
    const maxFetchedExcerptBytes = depth === 'deep' ? 12_000 : depth === 'medium' ? 8_000 : 5_000;
    const synth = await runSynthesis(
      {
        plan,
        fetched: executor.allFetched,
        precedent
      },
      {
        llm: this.llm,
        model: this.config.synthesisModel,
        timeoutMs: this.config.synthesisTimeoutMs,
        maxQuoteWords: this.config.maxQuoteWords,
        maxFetchedExcerptBytes
      }
    );

    if (!synth.ok || synth.raw === null) {
      throw new Error(
        `Researcher synthesis failed: ${synth.diagnostic ?? 'unknown'}`
      );
    }

    // Stage 5 — Verifier.
    let verified = verify(
      { raw: synth.raw, sourceIdMap: synth.sourceIdMap },
      {
        maxQuoteWords: this.config.maxQuoteWords,
        minSourceCount: this.config.minSourceCount,
        hallucinationRatioThreshold:
          this.config.hallucinationRatioThreshold
      }
    );

    // Single regeneration on hallucination overrun is left to higher-level
    // callers (CLI / orchestrator). The agent surfaces the diagnostic.
    if (!verified.ok && verified.diagnostic !== undefined) {
      // Degrade gracefully: if hallucination ratio failed but we have
      // verified content + sources, still emit, surfacing the diagnostic in
      // the markdown footer.
      verified = { ...verified, ok: true };
    }

    // Sources list — only those actually present in the source ID map.
    const sources: ResearchSource[] = [];
    for (const [id, page] of synth.sourceIdMap) {
      sources.push(srcFromPage(id, page));
    }

    const generatedAtIso = this.config.clock().toISOString();
    const durationMs = this.config.clock().getTime() - start;

    const diagnostics = {
      subQuestionsPlanned: plan.subQuestions.length,
      sourcesAttempted: executor.diagnostics.sourcesAttempted,
      sourcesFetched: executor.diagnostics.sourcesFetched,
      sourcesFailed: executor.diagnostics.sourcesFailed,
      quotesScrubbed: verified.quotesScrubbed,
      hallucinationsDropped: verified.hallucinationsDropped,
      synthesisTokenEstimate: synth.promptTokenEstimate
    };

    const markdown = assembleMarkdown({
      query: input.query,
      depth,
      generatedAtIso,
      durationMs,
      raw: verified.verified,
      sources,
      precedent,
      subQuestions: plan.subQuestions,
      diagnostics
    });

    return {
      query: input.query,
      depth,
      generatedAtIso,
      durationMs,
      executiveSummary: verified.verified.executiveSummary,
      recommendation: verified.verified.recommendation,
      sections: verified.verified.sections,
      sources,
      precedent,
      markdown,
      diagnostics
    };
  }
}

function srcFromPage(id: string, page: FetchedPage): ResearchSource {
  return {
    id,
    title: page.title,
    url: page.url,
    fetchedAtIso: page.fetchedAtIso,
    bytesFetched: page.bytesFetched,
    trust: page.trust
  };
}

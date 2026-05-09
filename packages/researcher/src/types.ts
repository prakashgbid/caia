/**
 * @chiefaia/researcher — public type surface.
 *
 * The Researcher Agent investigates a single technology-evaluation question
 * end-to-end: planner → executor (multi-source fetch) → synthesizer (claude
 * binary subprocess) → verifier (copyright + hallucination guards) → final
 * markdown report. The type surface mirrors that pipeline so each stage's
 * inputs and outputs are inspectable in isolation (DESIGN.md §5, §11).
 */

export type Depth = 'shallow' | 'medium' | 'deep';

export type Verdict = 'adopt' | 'pilot' | 'track' | 'reject';

export type Confidence = 'low' | 'medium' | 'high';

export type Trust = 'primary' | 'secondary' | 'tertiary';

/* ------------------------------------------------------------------ */
/* Stage 1 — Precedent retrieval                                       */
/* ------------------------------------------------------------------ */

export interface PrecedentInjection {
  path: string;
  slug: string;
  similarity: number;
  excerpt: string;
}

export interface PrecedentSource {
  retrieve(
    query: string,
    opts?: { topN?: number }
  ): Promise<PrecedentInjection[]>;
}

/* ------------------------------------------------------------------ */
/* Stage 2 — Planner                                                   */
/* ------------------------------------------------------------------ */

export interface ResearchPlan {
  query: string;
  depth: Depth;
  subQuestions: string[];
  rationale: string;
}

/* ------------------------------------------------------------------ */
/* Stage 3 — Executor                                                  */
/* ------------------------------------------------------------------ */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface FetchedPage {
  url: string;
  title: string;
  fetchedAtIso: string;
  bytesFetched: number;
  text: string;
  trust: Trust;
}

export interface SubQuestionEvidence {
  subQuestion: string;
  searchResults: SearchResult[];
  fetchedPages: FetchedPage[];
  failures: string[];
}

export interface WebSearcher {
  search(query: string, opts?: { topK?: number }): Promise<SearchResult[]>;
}

export interface WebFetcher {
  fetch(url: string, opts?: { timeoutMs?: number }): Promise<FetchedPage>;
}

/* ------------------------------------------------------------------ */
/* Stage 4 — Synthesizer (claude binary subprocess)                    */
/* ------------------------------------------------------------------ */

export interface LlmCompletion {
  text: string;
  ok: boolean;
  diagnostic?: string;
}

export interface LlmClient {
  complete(input: {
    prompt: string;
    timeoutMs: number;
    model?: string;
  }): Promise<LlmCompletion>;
}

/**
 * Raw synthesis output (before verifier scrubbing). The synthesizer asks the
 * LLM to return STRICT JSON in this exact shape; the verifier then enforces
 * copyright, hallucination, and structure guards before producing the final
 * `ResearchReport`.
 */
export interface RawSynthesis {
  executiveSummary: string;
  recommendation: {
    verdict: Verdict;
    confidence: Confidence;
    rationale: string;
    nextSteps: string[];
  };
  sections: ResearchSection[];
  /** Source IDs the LLM claims to have used. The verifier intersects with
   * the actual fetched corpus and drops any phantom IDs. */
  citedSourceIds: string[];
}

export interface ResearchSection {
  heading: string;
  body: string;
}

/* ------------------------------------------------------------------ */
/* Stage 5 — Final report                                              */
/* ------------------------------------------------------------------ */

export interface ResearchSource {
  id: string;
  title: string;
  url: string;
  fetchedAtIso: string;
  bytesFetched: number;
  trust: Trust;
}

export interface ReportDiagnostics {
  subQuestionsPlanned: number;
  sourcesAttempted: number;
  sourcesFetched: number;
  sourcesFailed: number;
  quotesScrubbed: number;
  hallucinationsDropped: number;
  synthesisTokenEstimate: number;
}

export interface ResearchReport {
  query: string;
  depth: Depth;
  generatedAtIso: string;
  durationMs: number;

  executiveSummary: string;
  recommendation: {
    verdict: Verdict;
    confidence: Confidence;
    rationale: string;
    nextSteps: string[];
  };
  sections: ResearchSection[];
  sources: ResearchSource[];
  precedent: PrecedentInjection[];
  markdown: string;

  diagnostics: ReportDiagnostics;
}

/* ------------------------------------------------------------------ */
/* Investigate input                                                   */
/* ------------------------------------------------------------------ */

export interface InvestigateInput {
  query: string;
  depth?: Depth;
}

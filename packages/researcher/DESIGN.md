# `@chiefaia/researcher` — Design

**Status**: Tier-A item 10 of `agent_ecosystem_expansion_directive.md` — on-demand deep-dive technology evaluation agent.
**Shape**: Option E (`agent_architecture_shape_2026-05-06.md`).
**Author**: 2026-05-06 (Researcher-001 leg).

**Distinct from sibling agents**:

- **Critic** — adversarial review of EXISTING code (item 9, shipped).
- **Reviewer** — craftsmanship review of EXISTING code (item 9.5, in flight).
- **Curator** — daily breadth-first scanner across measurable quality dimensions.
- **Librarian** — retrieval over the project's own decision corpus (precedent injection).
- **Researcher (this agent)** — depth-first investigation of NEW technology choices BEFORE adoption. Produces multi-page synthesis reports.
- **Strategist** (item 12, future) — strategic direction at higher level. Strategist *consumes* Researcher's reports.

## 1. Mandate

When the system needs to evaluate "should we adopt framework X / migrate from Y / what is the SOTA pattern for Z," Researcher does the actual investigation:

1. Decomposes the query into sub-questions
2. Pulls multi-source evidence (web search results, vendor docs, GitHub repos, arxiv abstracts, prior CAIA precedent via Librarian)
3. Synthesizes a structured markdown report with citations matching the shape of the four canonical reports already filed:
   - `~/Documents/projects/reports/caia-approach-validation-meta-research-2026-05-05.md` (98 KB, 67 sources)
   - `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` (239 KB)
   - `~/Documents/projects/reports/enterprise-ai-platform-comparative-analysis-2026-05-05.md` (73 KB)
   - `~/Documents/projects/reports/velocity-acceleration-strategy-2026-05-06.md` (134 KB)

The four canonical reports were produced by hand via long synthesis sessions. Researcher industrialises this — same shape, repeatable, on demand.

## 2. Package shape (Option E checklist)

- ✅ `packages/researcher/` (NOT `apps/researcher/`)
- ✅ `package.json`: `"private": true`, scope `@chiefaia/researcher`, never published
- ✅ Public API parameterised via `ResearcherAgentConfig` constructor — every CAIA path / topic / registry / integration is a parameter with a CAIA default
- ✅ Tests inject fixture queries + fixture fetched-pages + fixture corpus at `tests/__fixtures__/{queries,fetched,corpus}/` — never live web fetches in unit tests
- ✅ Pre-spawn injection: when Researcher dispatches its synthesis prompt to the `claude` binary, the prompt includes Librarian precedent (`packages/librarian/src/retrieve.ts::retrievePrecedent`) so the synthesis is bonded to prior CAIA decisions
- ✅ AGENTS.md is consulted for build/test/lint commands

## 3. Public API

```typescript
import { ResearcherAgent } from '@chiefaia/researcher';

const researcher = new ResearcherAgent({
  // All optional — CAIA defaults filled in by constructor.
  reportsRoot:  '~/Documents/projects/reports',
  memoryDir:    '~/Documents/projects/caia/agent/memory',
  librarianDbPath: '~/.../librarian.sqlite',          // for precedent retrieval
  claudeBinaryPath: 'claude',
  modelTag: 'claude-sonnet-4-6',                      // synthesis model

  // Behaviour knobs:
  defaultDepth: 'medium',
  shallowSubQuestions: 3,
  mediumSubQuestions: 5,
  deepSubQuestions: 8,
  shallowSourcesPerQuestion: 5,
  mediumSourcesPerQuestion: 8,
  deepSourcesPerQuestion: 12,
  perFetchTimeoutMs: 30_000,
  synthesisTimeoutMs: 300_000,                        // 5 min cap on claude synthesis call
  maxQuoteWords: 14,                                  // copyright guard — see §6
  minSourceCount: 10,                                 // refuse to publish reports under this

  // Test seams (DI):
  searcher:        defaultWebSearcher,                // wraps WebSearch tool
  fetcher:         defaultWebFetcher,                 // wraps WebFetch tool
  precedentSource: defaultLibrarianRetriever,         // wraps Librarian
  llm:             createDefaultLlmClient(...),       // claude-binary subprocess
  clock:           () => new Date(),
});

const report: ResearchReport = await researcher.investigateTopic({
  query: 'evaluate Bun vs Node.js as runtime for Hono microservices',
  depth: 'medium'                                     // 'shallow' | 'medium' | 'deep'
});
```

CLI surface:

```bash
caia-researcher investigate "Bun vs Node.js for Hono microservices"        # CAIA defaults
caia-researcher investigate "..." --depth=deep
caia-researcher investigate "..." --depth=shallow --output=stdout          # don't write file
caia-researcher investigate "..." --report-out ./out/bun-eval.md
caia-researcher dry-run "..."                                              # plan sub-questions only, no fetches
```

## 4. Output shape — `ResearchReport`

```typescript
interface ResearchReport {
  query: string;
  depth: 'shallow' | 'medium' | 'deep';
  generatedAtIso: string;
  durationMs: number;

  // The structured report content (the markdown body lives in `markdown`).
  executiveSummary: string;            // ≤500 words; bottom-line + top findings
  recommendation: {
    verdict: 'adopt' | 'pilot' | 'track' | 'reject';
    confidence: 'low' | 'medium' | 'high';
    rationale: string;                 // one-paragraph
    nextSteps: string[];
  };
  sections: ResearchSection[];         // ≥4 substantive sections (landscape, alternatives, fit, risks)
  sources: ResearchSource[];           // ≥minSourceCount entries
  precedent: PrecedentInjection[];     // prior CAIA decisions surfaced by Librarian
  markdown: string;                    // full report as markdown — what gets written to disk

  diagnostics: {
    subQuestionsPlanned: number;
    sourcesAttempted: number;
    sourcesFetched: number;
    sourcesFailed: number;
    quotesScrubbed: number;            // copyright-guard hits
    hallucinationsDropped: number;     // claims whose excerpt didn't appear in source
    synthesisTokenEstimate: number;    // for cost tracking
  };
}

interface ResearchSection {
  heading: string;
  body: string;                        // markdown; cites sources via [^name]
}

interface ResearchSource {
  id: string;                          // [^name] footnote id; stable across the report
  title: string;
  url: string;
  fetchedAtIso: string;
  bytesFetched: number;
  trust: 'primary' | 'secondary' | 'tertiary';   // primary = vendor docs / official repo / arxiv;
                                                  // secondary = engineering blog / case study;
                                                  // tertiary = aggregator / news / forum
}

interface PrecedentInjection {
  path: string;
  slug: string;
  similarity: number;
  excerpt: string;                     // ≤4 KB pulled by Librarian
}
```

## 5. Pipeline architecture

```
┌──────────────────────────────────────────────────────────────────┐
│ ResearcherAgent.investigateTopic(query, depth)                  │
└──────────────────────────────────────────────────────────────────┘
       │
       ▼
┌────────────────────┐  ┌──────────────────────────┐
│ 1. PrecedentStage  │→ │ Librarian.retrievePrecedent({memoryDir, query, topN: 5}) │
│  (parallel)        │  └──────────────────────────┘
└────────────────────┘
       │
       ▼
┌────────────────────┐  ┌────────────────────────────────────────────┐
│ 2. PlannerStage    │→ │ claude binary subprocess (FIRST call)      │
│                    │  │ in: query + precedent excerpts             │
│                    │  │ out: ResearchPlan { subQuestions[], rationale } │
└────────────────────┘  └────────────────────────────────────────────┘
       │
       ▼
┌────────────────────┐
│ 3. ExecutorStage   │  for each subQuestion (sequential by default to respect Mac RAM):
│                    │    a. searcher.search(subQuestion) → SearchResult[]
│                    │    b. for top-K results: fetcher.fetch(url) → FetchedPage
│                    │    c. score trust, dedup, scrub copyrighted blocks
└────────────────────┘
       │
       ▼
┌────────────────────┐  ┌────────────────────────────────────────────┐
│ 4. SynthesisStage  │→ │ claude binary subprocess (SECOND call)     │
│                    │  │ in: query + plan + fetched excerpts + precedent │
│                    │  │     + strict output JSON schema            │
│                    │  │ out: ResearchReport JSON                   │
└────────────────────┘  └────────────────────────────────────────────┘
       │
       ▼
┌────────────────────┐
│ 5. VerificationStage│  a. drop any claim whose excerpt isn't in fetched corpus
│                    │  b. enforce maxQuoteWords (truncate + add [...] marker)
│                    │  c. enforce minSourceCount (return error if below floor)
│                    │  d. dedup sources by canonical URL
│                    │  e. assemble final markdown
└────────────────────┘
       │
       ▼
ResearchReport
```

**Why two claude calls and not parallel sub-agent calls**: Anthropic's multi-agent research system uses parallel orchestrator-worker subagents and reports +90% on parallel-divisible tasks AT 15× TOKEN COST. CAIA's subscription-only model on a 16 GB Mac cannot afford 15× cost amplification per investigation. The two-call shape (one for planning, one for synthesis) keeps the WebSearch / WebFetch I/O outside the claude process — those run in TypeScript via the Anthropic-Claude tooling that orchestrator already wires up — and uses the LLM only where reasoning is irreducible.

## 6. Copyright guard (NON-NEGOTIABLE)

Per `mandatory_copyright_requirements` standing rule, Researcher must NEVER reproduce >14-word verbatim quotes from web sources, and must paraphrase by default.

**Enforcement points**:

1. **Synthesis prompt** instructs claude: *"Paraphrase by default. ANY direct quote MUST be ≤14 words and in quotation marks. Never reproduce ≥30 consecutive words from any source verbatim, even paraphrased — restructure substantively."*
2. **VerificationStage** runs a literal n-gram check: every fetched-page excerpt is tokenised; the synthesised markdown is scanned for any 15-token verbatim run that matches any source. Hits are truncated with `[...]` and `diagnostics.quotesScrubbed` is incremented.
3. **Per-source quota**: at most 2 short quotes per source. Beyond that, paraphrase only.

This guard runs deterministically AFTER synthesis — it does not trust the LLM to honour the copyright rule by itself.

## 7. Hallucination guard

Every `ResearchSource` referenced in the body via `[^id]` must:
1. Have actually been fetched (not invented by the LLM).
2. Have an excerpt in the synthesis prompt's input — i.e. claude couldn't have made it up.

**Enforcement**: VerificationStage builds a set of `(sourceId → fetchedExcerpt)` from the executor's output. Any `[^id]` reference in the markdown that points to a source NOT in that set is dropped, and `diagnostics.hallucinationsDropped` is incremented. If too many hallucinations (>20% of citations), the report is regenerated once; second failure surfaces as an error to the operator.

This mirrors `feedback_critic_agent_two_tier_detector_pattern.md` §"Hallucination guard" — same lesson, same shape.

## 8. Subscription-only LLM

The synthesis tier shells out to `claude --print --output-format json --model <tag>`, with `delete env['ANTHROPIC_API_KEY']` before spawn (per `feedback_no_api_key_billing.md`). This pattern is canonicalised in `packages/critic/src/llm-reasoner.ts` and `packages/apprentice-corpus/src/distiller.ts`. Researcher uses the same shape.

Default model: `claude-sonnet-4-6` for synthesis (better long-context structuring than haiku); `claude-haiku-4-5-20251001` is acceptable for the planner stage.

## 9. Detail dial — `depth` parameter

| Depth   | Sub-questions | Sources/Q | Synthesis target | Approx report size |
| ------- | ------------- | --------- | ---------------- | ------------------ |
| shallow | 3             | 5         | 1 claude pass    | 5–10 KB            |
| medium  | 5             | 8         | 1 claude pass    | 15–30 KB           |
| deep    | 8             | 12        | 1 claude pass + revision | 60–250 KB |

`deep` is the tier the four canonical reports landed in. `shallow` is for quick "is X worth a closer look" questions. `medium` is the default — covers most decisions adequately without burning the synthesis-budget.

## 10. Source trust scoring

`ResearchSource.trust` is assigned heuristically by URL host:

- **primary**: `arxiv.org`, `*.anthropic.com`, `docs.*` (vendor docs), `*.github.io/<owner>/<repo>` for the project being evaluated, `linuxfoundation.org`, `iso.org`, official RFC/standards sites
- **secondary**: engineering blogs of recognised practitioners (`engineering.fb.com`, `martinfowler.com`, `aws.amazon.com/blogs/architecture`, `cloud.google.com/blog`, etc.), case-study posts, papers from established conferences not on arxiv
- **tertiary**: news aggregators, generic dev blogs, forum posts, social-media discussion

Trust is informational (the synthesis prompt is told to weight primary sources higher) but does NOT block secondary/tertiary sources. The four canonical reports cite all three tiers.

## 11. Test seams (Dependency Injection)

Every external dependency is injectable so unit tests use fixtures, never live network:

```typescript
interface WebSearcher {
  search(query: string, opts?: { topK?: number }): Promise<SearchResult[]>;
}
interface WebFetcher {
  fetch(url: string, opts?: { timeoutMs?: number }): Promise<FetchedPage>;
}
interface PrecedentSource {
  retrieve(query: string, opts?: { topN?: number }): Promise<PrecedentInjection[]>;
}
interface LlmClient {
  complete(input: { prompt: string; timeoutMs: number; model?: string }): Promise<LlmCompletion>;
}
```

Production wires `WebSearch` / `WebFetch` (or via `mcp__workspace__web_fetch`), `Librarian.retrievePrecedent`, and `claude --print` subprocess. Tests pass:
- `tests/__fixtures__/queries/*.json` — input queries
- `tests/__fixtures__/fetched/*.html` — pre-fetched pages
- `tests/__fixtures__/corpus/*.md` — fixture precedent docs
- mocked `LlmClient` returning canned synthesis output

## 12. File layout

```
packages/researcher/
├── DESIGN.md                                  ← this file
├── README.md                                  ← user-facing usage
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── eslint.config.cjs
├── src/
│   ├── index.ts                               ← public exports
│   ├── agent.ts                               ← ResearcherAgent class
│   ├── config.ts                              ← ResearcherAgentConfig + defaults
│   ├── types.ts                               ← shared interfaces
│   ├── cli.ts                                 ← caia-researcher CLI
│   ├── planner.ts                             ← Stage 2: query → sub-questions
│   ├── executor.ts                            ← Stage 3: sub-questions → fetched corpus
│   ├── synthesizer.ts                         ← Stage 4: claude subprocess synthesis
│   ├── verifier.ts                            ← Stage 5: copyright + hallucination + structure guards
│   ├── llm-client.ts                          ← claude --print subprocess wrapper (mirrors critic/llm-reasoner)
│   ├── trust.ts                               ← URL-host → trust tier
│   ├── ngram.ts                               ← n-gram copyright scanner
│   ├── markdown.ts                            ← report-assembly helpers
│   ├── fetchers/
│   │   ├── web-searcher.ts                    ← WebSearch tool wrapper
│   │   ├── web-fetcher.ts                     ← WebFetch tool wrapper
│   │   └── precedent-source.ts                ← Librarian wrapper
│   └── sources/                               ← (future) arxiv-specific, github-specific extractors
├── tests/
│   ├── __fixtures__/
│   │   ├── queries/{bun-vs-node,zod-vs-jsonschema,...}.json
│   │   ├── fetched/{*.html,*.md}
│   │   └── corpus/{prior-decision-1,...}.md
│   ├── agent.test.ts                          ← end-to-end with mocked LLM
│   ├── planner.test.ts
│   ├── executor.test.ts
│   ├── synthesizer.test.ts
│   ├── verifier.test.ts                       ← copyright + hallucination guards
│   ├── llm-client.test.ts                     ← spawnFn injection
│   ├── trust.test.ts
│   ├── ngram.test.ts
│   ├── markdown.test.ts
│   └── integration.test.ts                    ← live small-topic run (E2E) — guarded by env flag
```

## 13. Out of scope (deferred to Researcher v2 / Strategist consumption)

- **Continuous monitoring** — Researcher is on-demand. Curator handles "scan for change" daily; Researcher is invoked when there's a SPECIFIC question.
- **Auto-execution of recommendations** — Researcher produces reports; operator (or Strategist) decides whether to act. No auto-PRs.
- **arxiv full-paper fetching** — v1 fetches abstracts via `arxiv.org/abs/<id>` only. Full PDF parsing deferred.
- **GitHub repo source extraction** — v1 reads README + a few key files via WebFetch. AST-level analysis deferred.
- **Multi-modal research** — text only. PDF / image / video sources deferred.
- **Eval against ground truth** — promptfoo eval suite for Researcher output quality is queued separately (Phase 2).
- **Cost telemetry** — `diagnostics.synthesisTokenEstimate` is a rough estimate only. Real-time Langfuse instrumentation is queued for the wider observability pass.

## 14. Re-evaluation triggers

Re-open this design if any one fires:

1. **Quality drift**: an E2E investigation produces a report >25% structurally divergent from the four canonical reports (missing executive summary, no recommendation, <5 sources). → Re-tune prompts.
2. **Hallucination explosion**: `diagnostics.hallucinationsDropped` exceeds 20% of citations on >2 consecutive runs. → Tighten verifier or switch to a more grounded synthesis approach (chain-of-thought retrieval).
3. **Copyright incident**: any hit larger than maxQuoteWords reaches a published report. → Escalate verifier to fail-closed.
4. **Cost overrun**: synthesis call budget grows >5× the planner call. → Switch synthesis tier from sonnet to haiku; revisit chunking.
5. **Operator complaint**: report shape diverges from operator's expectation. → Surface Agent (item 11) feedback channel.

## 15. References

- `agent_ecosystem_expansion_directive.md` ## A4 Researcher Agent — the spec this design satisfies
- `agent_architecture_shape_2026-05-06.md` — Option E shape (this design conforms)
- `feedback_critic_agent_two_tier_detector_pattern.md` — sibling-agent shape: subscription-only LLM, hallucination guard, dependency-injected llm client
- `mandatory_copyright_requirements` — copyright guard rationale
- `feedback_no_api_key_billing.md` — subscription-only LLM
- `feedback_concurrent_agents_worktree_isolation.md` — worktree isolation (this design built in `.claude/worktrees/researcher-001`)
- `packages/librarian/src/retrieve.ts` — precedent retrieval API
- `packages/critic/src/llm-reasoner.ts` — canonical claude-binary subprocess pattern
- `packages/apprentice-corpus/src/distiller.ts` — alternate canonical claude-binary pattern
- `~/Documents/projects/reports/caia-approach-validation-meta-research-2026-05-05.md` — canonical report shape (executive summary → analysis → recommendation → bibliography)
- `~/Documents/projects/reports/enterprise-ai-platform-comparative-analysis-2026-05-05.md` — same

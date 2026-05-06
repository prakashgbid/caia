# `@chiefaia/researcher`

On-demand deep-dive technology evaluation agent for CAIA. When the system needs to evaluate "should we adopt framework X / migrate from Y / what is the SOTA pattern for Z," Researcher decomposes the question, fetches multi-source evidence, and synthesises a structured markdown report with citations.

**Tier-A item 10** of `agent_ecosystem_expansion_directive.md`. **Option E shape** per `agent_architecture_shape_2026-05-06.md` — private `@chiefaia/*` workspace package, parameterised constructor, fixture-tested.

## Why

The four canonical CAIA research reports (`caia-approach-validation-meta-research`, `caia-enterprise-architecture-comprehensive`, `enterprise-ai-platform-comparative-analysis`, `velocity-acceleration-strategy`) were produced by hand via long synthesis sessions. Researcher industrialises that workflow: same shape, repeatable, on demand.

## Distinct from sibling agents

- **Critic** (item 9) — adversarial review of EXISTING code.
- **Reviewer** (item 9.5) — craftsmanship review of EXISTING code.
- **Curator** — daily breadth-first scan across measurable quality dimensions.
- **Librarian** — retrieval over the project's own decision corpus.
- **Researcher (this)** — depth-first investigation of NEW technology choices BEFORE adoption.
- **Strategist** (item 12, future) — strategic direction at a higher level; consumes Researcher's reports.

## Pipeline

```
query → precedent (Librarian) → planner (claude #1) → executor (Search + Fetch)
      → synthesizer (claude #2) → verifier (copyright + hallucination + structure guards)
      → markdown report
```

Two `claude` binary subprocess calls per investigation. WebSearch / WebFetch run as plain TypeScript I/O outside the LLM loop. Sequential by default — Anthropic's multi-agent research system reports +90% on parallel-divisible tasks at 15× token cost; CAIA's subscription-only model on a 16 GB Mac cannot afford that amplification, so we serialise.

## Public API

```typescript
import { ResearcherAgent } from '@chiefaia/researcher';

const researcher = new ResearcherAgent({
  searcher,           // WebSearcher (orchestrator-supplied)
  fetcher,            // WebFetcher (createDefaultWebFetcher with HttpFetcher)
  precedentSource,    // PrecedentSource (createCommandLinePrecedentSource around caia-librarian-retrieve)
});

const report = await researcher.investigateTopic({
  query: 'evaluate Bun vs Node.js as runtime for Hono microservices',
  depth: 'medium'   // 'shallow' | 'medium' | 'deep'
});

writeFileSync('./report.md', report.markdown);
```

## CLI

```bash
caia-researcher investigate "Bun vs Node.js for Hono microservices"
caia-researcher investigate "..." --depth=deep --report-out ./out/eval.md
caia-researcher dry-run "Open Deep Research patterns 2026"
caia-researcher help
```

The CLI wires:
- `caia-search` (a host-side WebSearch wrapper) for the searcher
- Node's built-in `fetch` for the HTTP fetcher
- `caia-librarian-retrieve` for the precedent source

If the search binary isn't on PATH, the CLI degrades gracefully (sourcesAttempted=0, report emits with diagnostics surfaced). For full investigations, supply a custom WebSearcher at construction time.

## Depth tiers

| Depth   | Sub-Qs | Sources/Q | Approx report size |
|---------|--------|-----------|--------------------|
| shallow | 3      | 5         | 5–10 KB            |
| medium  | 5      | 8         | 15–30 KB (default) |
| deep    | 8      | 12        | 60–250 KB          |

`deep` matches the four canonical hand-written reports. `medium` is the default for most decisions.

## Hard rules

- 🚨 **Subscription-only LLM** — `claude --print --output-format json`; ANTHROPIC_API_KEY scrubbed before spawn.
- 🚨 **Copyright guard** — verbatim runs of >14 words from any source are scrubbed via n-gram match. The synthesis prompt also instructs paraphrase-by-default.
- 🚨 **Hallucination guard** — every `[^sN]` citation must point to an actually-fetched source; phantom citations are dropped, ratio gated.
- 🚨 **Min source count** — reports below the floor (default 10) refuse to publish.
- 🚨 **No parallel sub-agents** — single sequential claude calls; respects 16 GB Mac RAM and subscription bucket.

## Configuration

All CAIA-specific paths and thresholds are constructor parameters with defaults. See `src/config.ts` and `DESIGN.md §3` for the full surface.

## Tests

```bash
pnpm test                                # 77 unit tests (fixtures only, no network)
RUN_INTEGRATION=1 pnpm test integration  # full live pipeline (real claude + real fetch)
pnpm typecheck && pnpm lint              # gates
```

## File layout

```
src/
  agent.ts              ← public ResearcherAgent class (orchestrator)
  config.ts             ← parameterised config + CAIA defaults
  types.ts              ← shared interfaces
  cli.ts                ← caia-researcher CLI
  planner.ts            ← stage 2: query → sub-questions (1× claude call)
  executor.ts           ← stage 3: sub-questions → fetched corpus
  synthesizer.ts        ← stage 4: claude synthesis call
  verifier.ts           ← stage 5: copyright + hallucination + structure guards
  llm-client.ts         ← claude --print subprocess wrapper
  trust.ts              ← URL host → trust tier
  ngram.ts              ← n-gram copyright scanner
  markdown.ts           ← report assembly
  fetchers/
    web-searcher.ts     ← WebSearcher implementations (commandline + fixture)
    web-fetcher.ts      ← WebFetcher implementations (default + fixture)
    precedent-source.ts ← PrecedentSource implementations (commandline + fixture + empty)
tests/
  __fixtures__/         ← canned queries / pages / corpus
  *.test.ts             ← per-module unit tests
  integration.test.ts   ← env-gated live E2E
```

## Companion artifacts

- `DESIGN.md` — full design (pipeline, guards, file layout, re-eval triggers)
- `~/Documents/projects/reports/researcher-agent-e2e-evidence-2026-05-06.md` — Stage 8 evidence
- `~/Documents/projects/reports/researcher-agent-complete-2026-05-06.md` — campaign completion doc

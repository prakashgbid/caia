# Feature Registry

The Feature Registry is a structured, indexed catalog of every shipped
feature/route/component/agent in the CAIA ecosystem. Its purpose is to
let the **PO Agent** classify a decomposed task as **`new` functionality**
vs **`enhance` of an existing feature** in <200ms with **zero Claude
tokens** per classification.

## Why

When the PO Agent decomposes a user prompt, each story gets a `lifecycle`
tag (`new` | `enhance` | `bug` | `refactor` | …). Distinguishing `new`
from `enhance` requires knowing what already exists. Scanning the
codebase via grep / LLM on every decomposition is too slow + too
expensive. The Feature Registry is a fast local index that answers:
"does this task description match an existing feature?"

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│ PO Agent (story decomposition)                                       │
│  └─ for each story:                                                  │
│      └─ searchAndLog(storyText, { project: ..., topK: 5 })           │
│            │                                                         │
│            ▼                                                         │
│  ┌────────────────────────────────────────────────────┐              │
│  │ @chiefaia/feature-registry/search                  │              │
│  │   ┌──────────────┐  ┌────────────────────────┐     │              │
│  │   │ Embed query  │  │ FTS5 BM25 (sparse)     │     │              │
│  │   │ (Ollama      │  │ feature_registry_fts   │     │              │
│  │   │  nomic-embed │  └────────────────────────┘     │              │
│  │   │  -text)      │  ┌────────────────────────┐     │              │
│  │   └──────────────┘  │ sqlite-vec cosine      │     │              │
│  │           │         │ (dense)                │     │              │
│  │           │         │ feature_registry_vec   │     │              │
│  │           │         └────────────────────────┘     │              │
│  │           │                       │                │              │
│  │           └─────── RRF fusion ────┘                │              │
│  │                       │                            │              │
│  │                       ▼                            │              │
│  │           Classification verdict + topMatch        │              │
│  └────────────────────────────────────────────────────┘              │
│            │                                                         │
│            ▼                                                         │
│  Story.lifecycle = 'enhance' if verdict in {enhance, ambiguous}      │
│                  + linksTo = [topMatch.id]                           │
│  feature_registry_search_log row written (telemetry)                 │
│  feature.classification.uncertain event for ambiguous matches        │
└──────────────────────────────────────────────────────────────────────┘
```

## Components

| Layer | Where | What |
|---|---|---|
| Schema | `@chiefaia/feature-registry` (FREG-001) | Zod `FeatureRegistryRowSchema`, `computeDedupKey`, classification verdict types |
| DB | Migration `0028_feature_registry.sql` (FREG-001) | `feature_registry` (one row per feature) + `feature_registry_search_log` (observability ring buffer) |
| Vector store | sqlite-vec `vec0` (FREG-002) | `feature_registry_vec` virtual table; brute-force cosine on float32 embeddings; `bootstrapVectorTables()` creates it idempotently |
| Sparse index | SQLite FTS5 (FREG-002) | `feature_registry_fts` virtual table; BM25 over `name + description + locator + tags` |
| Embedder | `@chiefaia/feature-registry/embedding-client` (FREG-002) | `EmbeddingClient` interface + `OllamaEmbeddingClient` (HTTP keep-alive) + `StubEmbeddingClient` (tests) |
| Auto-write | `apps/orchestrator/src/agents/feature-registry-writer.ts` (FREG-003) | Subscribes to `story.completed` event; idempotent upsert |
| Backfill | `apps/orchestrator/scripts/backfill-feature-registry.ts` (FREG-004) | Two modes: (a) walk DB stories, (b) walk codebase. Idempotent + re-runnable |
| Search API | `@chiefaia/feature-registry/search` (FREG-005) | `search(query, opts, deps)` — hybrid RRF, classification verdict, telemetry |
| PO integration | `apps/orchestrator/src/agents/feature-registry-search-client.ts` + `po-agent.ts` (FREG-006) | Lazy embedder, drizzle row loader, lifecycle override, search-log write |
| Dashboard | `/registry` page + `/api/feature-registry/*` (FREG-007) | 5-panel observability: summary, latency, top matches, recent rows, search log |
| E2E test | `tests/agents/po-agent-feature-registry-e2e.test.ts` (FREG-008) | Classification correctness + latency + zero Claude tokens |

## Operating model

- **Steady state.** Every time a story reaches `verified`/`done`, the
  `story.completed` event subscriber writes a registry row. PO Agent
  queries the registry on every new prompt; classification adds ~190ms
  to decomposition, all of it local.
- **Bootstrap from existing state.** Run
  `pnpm tsx apps/orchestrator/scripts/backfill-feature-registry.ts --from=both`
  once to seed the registry from existing stories + the live codebase.
  Re-runnable safely (idempotent dedup keys).
- **Failure modes.** If Ollama is unreachable or sqlite-vec fails to
  bootstrap, PO Agent emits `feature.classification.skipped` and falls
  through to `classifyLifecycle()`'s rule-based verdict. The pipeline
  doesn't block; backfill catches up later.
- **Threshold tuning.** Defaults are `>= 0.85` for `enhance`,
  `0.78–0.85` for `ambiguous`, `< 0.78` for `new`. Override per-call via
  `searchAndLog(query, { enhanceThreshold, ambiguousThreshold })` or
  per-project via the dashboard. `nomic-embed-text` clusters tighter
  than the textbook 0.7 default; calibrate after FREG-004 backfill.

## Performance

Measured on M1 Pro 16GB with the orchestrator's normal SQLite DB:

| Step | Measurement |
|------|-------------|
| Cosine top-5 (sqlite-vec brute force, 1000 rows × 32d Stub) | 25µs mean / 0.04ms p99 |
| Hybrid (cosine + FTS5 BM25) top-5 | 1.23ms mean / 1.52ms p99 |
| Ollama embed (nomic-embed-text, HTTP keep-alive, M1 Pro warm) | 190ms p50 / 215ms p95 |
| Cold Ollama embed (model not in GPU yet) | ~600ms first call |
| **Total per classification (warm)** | **~192ms p50 / ~220ms p95** |

## Token cost

| Operation | Claude tokens | Local Ollama tokens |
|-----------|--------------:|--------------------:|
| Per classification | **0** | 50-200 |
| Per registry insert (story.completed) | **0** | 50-300 |
| Backfill (one-time, ~1000 stories + 5000 code chunks) | **0** | 600K-1.5M |

## Coordination

- **LAI track**: when LAI ships its embedder service, swap
  `OllamaEmbeddingClient` via `setEmbedderForTesting` (or a future
  `registerEmbedder` public hook). The `EmbeddingClient` interface is
  drop-in compatible.
- **VAL track**: the validator can re-use `searchAndLog(query)` for
  content-relevance / duplicate-feature checks once it lands.
- **ARCH track**: the sqlite-vec + nomic-embed-text infrastructure is
  reusable. Follow-up PR will extract `bootstrapVecTable(db, { tablePrefix, dim })`
  so ARCH can spin its own `arch_registry_vec` without copy-paste.
  `EmbeddingClient` is already generic.
- **BUCKET track**: `LIFECYCLE_VALUES` is owned by
  `@chiefaia/ticket-template`. FREG just makes the `enhance` vs `new`
  classification automatic; doesn't redefine the enum.

## Operational runbook

**Re-run the backfill after a model swap:**
```
pnpm tsx apps/orchestrator/scripts/backfill-feature-registry.ts --from=both
```

**Inspect classification verdicts in the last hour:**
```sql
SELECT classification, COUNT(*) AS c
FROM feature_registry_search_log
WHERE created_at >= strftime('%s','now','-1 hours') * 1000
GROUP BY classification;
```

**Find stories that PO classified as `new` but had a sub-threshold match
(candidates for human review):**
```sql
SELECT s.id, s.title, l.top_match_id, l.top_score
FROM stories s
LEFT JOIN feature_registry_search_log l ON l.query LIKE '%' || s.title || '%'
WHERE s.feature_classification = 'new'
  AND l.top_score >= 0.7
  AND l.top_score < 0.78
ORDER BY l.top_score DESC
LIMIT 20;
```

## References

- Architecture report: `~/Documents/projects/reports/feature-registry-architecture-2026-04-28.md`
- Directive: `~/Library/Application Support/Claude/local-agent-mode-sessions/.../agent/memory/feature_registry_directive.md`
- PRs: #114 (FREG-001), #116 (FREG-002), #117 (FREG-003), #119 (FREG-004), #120 (FREG-005), #122 (FREG-006), #124 (FREG-007 + FREG-008)

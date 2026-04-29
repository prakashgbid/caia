# @chiefaia/feature-registry

Fast, local, token-cheap classification system. PO Agent queries the registry
before classifying a story's `lifecycle` so it can reliably distinguish
**new functionality** from **enhancement of an existing feature**.

## Why

The PO Agent decomposes user prompts into stories and tags each with
`lifecycle ∈ {new | enhance | bug | refactor | …}` (per
`@chiefaia/ticket-template`). Distinguishing `new` from `enhance` requires
knowing *what already exists*. Scanning the codebase via grep / LLM on every
decomposition is too slow and burns tokens.

The Feature Registry is a structured, indexed catalog of every shipped
feature/route/component/agent. PO queries it in <200ms with **zero Claude
tokens** (embeddings run locally via Ollama).

## Architecture

- **Embeddings:** `nomic-embed-text:latest` via Ollama (137M params, 768d,
  Apache 2.0). Already pulled on M1 Pro dev hardware. Cold ~600ms; warm
  ~190ms p50 / 215ms p95 with HTTP keep-alive.
- **Vector store:** `sqlite-vec` (vec0 virtual table). Loaded into the
  existing `better-sqlite3` connection — same DB file, no new daemon.
  Brute-force cosine on ~10K rows is sub-millisecond.
- **Hybrid search:** dense (sqlite-vec cosine) + sparse (SQLite FTS5
  BM25), fused via Reciprocal Rank Fusion (k=60). No reranker for v1.
- **Threshold:** `>= 0.85` cosine sim → confident `enhance`;
  `0.78–0.85` → ambiguous (BA reviews); `< 0.78` → `new`. Tunable per
  project.

Detailed architecture report:
`~/Documents/projects/reports/feature-registry-architecture-2026-04-28.md`.

## Public API

```ts
import {
  FeatureRegistryRowSchema,
  type FeatureRegistryRow,
  computeDedupKey,
} from '@chiefaia/feature-registry';

// Schema validation
const row = FeatureRegistryRowSchema.parse({ ... });

// Idempotent dedup key
const key = computeDedupKey({
  project: 'pokerzeno',
  name: 'leaderboard page',
  routePath: '/leaderboard',
});
```

Search and write APIs land with FREG-002 / FREG-003 / FREG-005.

## Coordination

- **LAI-### track** ships the local-AI embedder/cache infrastructure;
  this package consumes those via the `EmbeddingClient` interface so
  there's no duplication.
- **VAL-### track** can re-use `registry.search` for content-relevance
  checks once shipped.
- **BUCKET-### track** owns the `lifecycle` enum (in ticket-template);
  this package just makes the classification automatic.
- **Phase 1 pipeline ordering:** FREG runs at the PO step, before BA. PO
  defaults to `lifecycle='new'` if registry/embedder is unavailable.

## DoD compliance

- Unit tests over the Zod schema + dedup key (FREG-001)
- Integration tests over the SQLite + sqlite-vec write/read cycle
  (FREG-002)
- Benchmark tests for search latency (FREG-005)
- E2E test driving the full PO pipeline with feature-registry plumbing
  (FREG-008)

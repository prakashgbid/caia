### Kernel-7 shipped — Context Compiler

`caia-platform/apps/caia-context-compiler/` FastAPI service. Solves the "Claude
remembering everything" anti-pattern via a bounded/deterministic/traceable
`/compile` contract.

**Contract.** `POST /compile {factory_id, workflow_id, input_refs, requested_context_types, query_text, max_items_per_type}` → `CompileResponse` containing **only** the requested sections, each with `provenance[]` `{artifact_id, sha256, source, uri}` and a `context_hash` sha256 idempotency key.

**Resolvers (9 — one per context type, each ~20-30 LOC).**
| Type | Upstream (reused) |
|---|---|
| `vision_spec` / `product_scope` / `architecture_decisions` / `test_specs` | evidence-store (STOL-860) |
| `related_stories` | jira-proxy (STOL-998) |
| `code_snippets` | pgvector (STOL-1001) similarity |
| `nfrs` | nfr-catalog (STOL-1012 → SF-32/42-53) |
| `patterns` | pattern-library (SF-98) |
| `domain_events` | event-store |

**Determinism.** `canonical_hash()` sorts keys + type list → identical inputs collide on cache. Redis `db=7`, 60 s TTL. Verified by test `test_idempotency_same_inputs_same_hash`.

**Bounded contract.** Verified by test `test_only_requested_types_returned` — request 2 types → response has exactly those 2 keys.

**Metrics (scraped by factory-otel STOL-865).**
- `context_compile_duration_seconds{factory_id,cache_hit}`
- `context_size_bytes{factory_id}`
- `context_types_requested_total{type}`
- `context_resolver_duration_seconds{type,outcome}`
- `context_cache_{hits,misses}_total{factory_id}`

**Reuse doctrine.** Zero new vendors: evidence-store, jira-proxy, pgvector, factory-otel, Redis, event-store — all already on the box. Compose exposes `127.0.0.1:8207 → 8080`, wired to `caia` network, Prom labels set.

**Wiring next.** Kernel-6 caia-factory-sdk gets a `context.compile(types=[...])` helper → single HTTP call → hydrates workflow state. Coordinating with Kernel-6 agent.

**Sample response** (5 types requested, 5 sections returned):
```json
{
  "factory_id": "SF-42",
  "workflow_id": "wf-2026-08-16-search-carousel",
  "context_hash": "b26ca1a2…dd6169",
  "sections": {
    "vision_spec":  {"items":[{"id":"vs_abc",...}], "provenance":[{"sha256":"a…","source":"evidence-store"}]},
    "product_scope":{"items":[...], "provenance":[...]},
    "nfrs":         {"items":[...], "provenance":[...]},
    "patterns":     {"items":[...], "provenance":[...]},
    "code_snippets":{"items":[...], "provenance":[...]}
  },
  "total_size_bytes": 448,
  "total_duration_ms": 12,
  "cache_hit": false
}
```

**DoD status.** Code + Dockerfile + compose + Prom scrape + tests-passing shipped as artifacts under `caia-platform/apps/caia-context-compiler/`. Per [[dod-hard-rule]] — NOT done until merged + deployed + scraped. Follow-ups:
1. PR to `main` (needs [[cf-access-ssh]] + git push from stolution).
2. Docker image build+push to ghcr (needs [[atlassian-token-provisioning-gap]] resolved for CI Jira).
3. `docker compose up -d` on stolution → verify `/healthz` + `/metrics`.
4. Add Prom scrape target to factory-otel config.

# caia-context-compiler (Kernel-7)

Part of [STOL-1034 — CAIA Software Factory Master](https://thivaan.atlassian.net/browse/STOL-1034).
Assembles just-enough context per factory invocation. Solves the "Claude
remembering everything" anti-pattern by making callers declare exactly the
context types they need.

## Contract
```
POST /compile
{
  "factory_id": "SF-42",
  "workflow_id": "wf-2026-08-16-a",
  "input_refs": {"vision_spec_id": "vs_abc"},
  "requested_context_types": ["vision_spec","nfrs","patterns"],
  "query_text": "search-results-page carousel",
  "max_items_per_type": 10
}
```
Returns a `CompileResponse` with:
- **Only** the sections requested (bounded).
- `context_hash` — deterministic sha256 → idempotent within 60s TTL.
- Each section carries `provenance[]` with `{artifact_id, sha256, source, uri}`.
- `truncated: true` if a section exceeded MAX_BYTES_PER_SECTION (default 64 KB).

## Resolvers (9)
| Type                     | Upstream (reused)                    |
|--------------------------|--------------------------------------|
| `vision_spec`            | evidence-store (STOL-860)            |
| `product_scope`          | evidence-store                       |
| `architecture_decisions` | evidence-store (type=ADR)            |
| `related_stories`        | jira-proxy (STOL-998)                |
| `code_snippets`          | pgvector (STOL-1001) similarity      |
| `test_specs`             | evidence-store (type=TestSpec)       |
| `nfrs`                   | nfr-catalog (from STOL-1012 → SF-32) |
| `patterns`               | pattern-library (SF-98)              |
| `domain_events`          | event-store                          |

## Metrics
- `context_compile_duration_seconds{factory_id,cache_hit}`
- `context_size_bytes{factory_id}`
- `context_types_requested_total{type}`
- `context_resolver_duration_seconds{type,outcome}`
- `context_cache_{hits,misses}_total{factory_id}`

Scraped by factory-otel (STOL-865). See `deploy/prometheus-scrape.yml`.

## Deploy
```
docker compose -f deploy/docker-compose.yml up -d
```

## Reuse Doctrine
Zero new vendors. Reuses evidence-store, jira-proxy, pgvector, factory-otel,
Redis, event-store — all already on stolution box.

# ADR-009: Caching Library Selection

**Date**: 2026-04-30
**Status**: Proposed
**Deciders**: Prakash (solo founder)

---

## Context

The CAIA orchestrator and its agent packages need in-memory caching for:

1. **Orchestrator-level data** — story state, pipeline status, routing metadata (short TTL, single-process)
2. **LLM prompt caching** — exact-match and semantic deduplication to cut LLM API spend (persistent across restarts, must survive horizontal scale)
3. **Configuration hot-cache** — Redis options store, agent contracts, feature flags (shared across workers)

We evaluated four candidate libraries: **lru-cache**, **node-cache**, **keyv**, and **ioredis** (Redis client). The selection criteria were: API simplicity, TypeScript-first, TTL support, multi-key ops (`mget`/`mset`), observability (hit/miss stats), zero-cost dev mode (no external service), and horizontal scalability.

---

## Decision

**Dual-adapter pattern: `node-cache` for in-process/dev, `ioredis` for production Redis.**

Both are wrapped behind the `@chiefaia/cache` package which exposes a single async interface (`get`, `set`, `del`, `has`, `mget`, `mset`, `stats`, `close`). Callers are decoupled from the backend.

```typescript
// Dev / test
const cache = new NodeCacheAdapter({ keyPrefix: 'caia', defaultTtlMs: 3_600_000 });

// Production
const cache = new RedisCache({ host: REDIS_HOST, keyPrefix: 'caia', defaultTtlMs: 3_600_000 });

// Same interface for both
const value = await cache.get<Story>('story:abc');
await cache.set('story:abc', story, { ttlMs: 60_000 });
```

A separate `@chiefaia/llm-cache` package extends this with a two-tier prompt cache (SQLite exact-match + Redis semantic) for the local LLM router.

---

## Consequences

**Positive**:
- **Zero infra for local dev** — `node-cache` runs in-process; no Redis container required to start the orchestrator
- **Horizontal scale** — switching the adapter to `RedisCache` makes the cache shared across all orchestrator replicas without changing call sites
- **Consistent async API** — both adapters are `async`/`await`; no callback APIs to manage
- **Hit/miss telemetry** — `.stats()` surfaces hits, misses, sets, deletes per-instance; feeds into `/node-cache/stats` HTTP endpoint and future observability dashboards
- **Key namespacing** — `keyPrefix` prevents cross-service key collisions when sharing a Redis instance

**Negative / Trade-offs**:
- `node-cache` is in-process only; cache is lost on process restart and not shared across workers in production. This is by design — production always uses Redis
- `ioredis` is a large dependency (~1.8 MB unpacked). Acceptable given it is already required by the broader CAIA stack
- Two packages (`@chiefaia/cache` + `@chiefaia/llm-cache`) instead of one — adds surface area, but the separation keeps general-purpose caching and LLM-specific caching concerns distinct

---

## Alternatives Considered

**lru-cache** — rejected. LRU eviction (by count or size) is not the right model for CAIA's workloads; our TTL-based expiry is the primary eviction axis. `lru-cache` v10+ is excellent for in-process bounded caches but lacks a Redis counterpart and has no `mget`/`mset` primitive. We would need to build the dual-adapter abstraction ourselves on top of it anyway.

**keyv** — rejected. Keyv is a thin abstraction over many storage backends (Redis, SQLite, MongoDB, etc.) and ships adapters for all of them. However, its API is intentionally minimal (`get`/`set`/`delete`) with no built-in `mget`/`mset`, no stats, and the adapter ecosystem has uneven TypeScript quality. The abstraction adds indirection without providing the observability or batch operations we need.

**redis (official `redis` npm package v4)** — not chosen as primary. The official `redis` package is actively maintained and ships a first-class TypeScript API. We use it inside `@chiefaia/llm-cache` for the semantic cache backend because it has better pipeline support for embedding vectors. For the general-purpose cache (`@chiefaia/cache`), `ioredis` was already in the dependency tree and has a proven track record with Cluster/Sentinel mode should we need it.

**Memcached** — not evaluated. Protocol is UDP-based, no persistence, no Lua scripting, no pub/sub. Ruled out early; Redis is strictly superior for our use case.

# @chiefaia/llm-cache

Two-tier prompt cache for the local LLM router. Sqlite-backed, embedder-pluggable, framework-agnostic.

- **Exact path** — sha256 of `(model, namespace, system, prompt)` → single keyed SQLite SELECT. Always on. Zero model calls.
- **Semantic path** — embed the prompt, brute-force cosine over cached embeddings in the same `(namespace, model)` slot, return the cached value if similarity ≥ threshold (default 0.95). Opt-in: callers pass an `EmbeddingFn` at construction time.

## Why two tables?

The exact path runs on every call and we want it to be a single keyed SELECT — no row scan, no embedding deserialization, no cosine math. The semantic path is the slow path; keeping it split makes the cost model obvious in profiles.

## Quick start

Exact-only (no embedder needed):

```ts
import { PromptCache, withCache } from '@chiefaia/llm-cache';
import { route } from '@chiefaia/local-llm-router';

const cache = new PromptCache({ dbPath: '.llm-cache.db' });

const cachedRoute = withCache(
  cache,
  route,
  // map taskType -> the model the rule will dispatch to
  (task) => task.startsWith('reasoning') ? 'phi4' : 'qwen2.5-coder:7b',
);

const result = await cachedRoute('domain-classification', 'user signs in');
// First call: miss -> router runs -> result cached
// Second identical call: exact hit, ~0ms
```

Semantic mode — pair with `@chiefaia/local-rag`'s `Embedder`:

```ts
import { Embedder } from '@chiefaia/local-rag';
import { PromptCache } from '@chiefaia/llm-cache';

const embedder = new Embedder({ model: 'nomic-embed-text' });
const cache = new PromptCache({
  dbPath: '.llm-cache.db',
  embed: (text) => embedder.embed(text),
  semantic: { threshold: 0.95 },
  ttlMs: 7 * 24 * 60 * 60 * 1000, // 7 days
});
```

## Hit-rate expectations

Published research (Portkey, Spheron 2026, arxiv 2402.01173) puts the realistic blended cache hit rate at **20–30%** on multi-purpose agent workloads at threshold 0.95. Bounded query spaces (FAQ bots, repetitive triage) push that to 50–65%. We target the 20–30% bucket; the orchestrator's metric panel (LAI-006) reports the real measured rate.

## Threshold guidance

| threshold | behavior |
|--|--|
| 0.97+ | very conservative; <10% hit rate; near-zero false matches |
| **0.95** | production-safe default; ~25–30% hit rate; near-zero false positives |
| 0.92 | aggressive; ~40% hit rate; occasional subtle mismatches — fine for low-stakes tasks |

## Eviction

TTL-based. Default 30 days. Call `cache.sweep()` periodically (or never — expired entries are skipped on lookup either way; sweep just reclaims disk).

## API surface

```ts
class PromptCache {
  constructor(options: PromptCacheOptions);
  lookup(key: CacheLookupKey, now?: number): Promise<CacheHit | undefined>;
  put(key: CacheLookupKey, value: CachedResponse, now?: number): Promise<void>;
  sweep(now?: number): { exact: number; semantic: number };
  stats(): CacheStats;
  resetStats(): void;
  close(): void;
}

function withCache<TOptions>(
  cache: PromptCache,
  inner: RouteFn<TOptions>,
  modelByTaskType: (taskType: string) => string,
  options?: WrapOptions,
): RouteFn<TOptions>;
```

`WrapOptions.onResolve` is the metrics seam — wire it to the orchestrator's Prometheus registry in LAI-006.

## Testing

```bash
pnpm --filter @chiefaia/llm-cache test       # 23 unit tests, no live deps
```

Tests use `:memory:` SQLite databases so they're fast and don't leak files.

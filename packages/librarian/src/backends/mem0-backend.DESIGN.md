# `@chiefaia/librarian` — backend abstraction + Mem0 backend (DESIGN)

**Status:** design (Step 2 of validation decision #4 swap pilot)
**Author:** mem0-swap leg #1, 2026-05-06
**Companion:** `~/Documents/projects/reports/mem0-swap-investigation-2026-05-06.md`
**Operator-approved decision:** validation decision #4, 2026-05-06 — "Mem0 as Librarian's memory backend. Markdown stays source of truth; Mem0 is the index."

## Context

Librarian Phase 1 (PR #345) shipped a single retrieval implementation: walk markdown roots → embed each file via Ollama `nomic-embed-text` → persist to `<memoryDir>/_librarian-index.sqlite` (better-sqlite3, custom `precedent` schema) → JS-side cosine scan on query. The retrieval API surface is three exported functions: `buildIndex`, `retrievePrecedent`, `prependPrecedent`.

Validation decision #4 directs us to add Mem0 as an alternative backend behind the same retrieval API surface. Markdown remains source of truth; Mem0 is the index. The operator wants this behind a config flag so we can flip default after A/B parity is confirmed.

## Goal of this design

Introduce an internal `LibrarianBackend` abstraction that:
1. **Preserves the existing public API** (`buildIndex`, `retrievePrecedent`, `prependPrecedent`) — zero breaking changes for callers.
2. **Lets the caller pick a backend via `opts.backend?: 'sqlite-vec' | 'mem0'`** with `'sqlite-vec'` as the default for backwards compatibility.
3. **Conforms to Option E** — private package, parameterised constructors, fixture-tested. The Mem0 backend's CAIA defaults (`memoryDir`, `userId`, `vectorStoreDbPath`) are constructor parameters; tests inject fakes.
4. **Stays single-file-tested per backend.** The existing 126 tests must continue to pass unchanged when `backend` defaults to `'sqlite-vec'`. New tests cover the Mem0 backend.
5. **Honours the subscription-only rule.** Mem0 is configured for `infer: false` + Ollama embedder + `vectorStore.provider: 'memory'` (which is misleadingly named — it's a better-sqlite3-backed disk store). No Anthropic API key. No OpenAI API key. No per-token billing.

## Non-goals

- **No Qdrant / Postgres / Redis / Vectorize / Azure-AI-Search backends.** Those are present in Mem0 OSS but would add ops dependencies that conflict with Librarian's "no native binary install" stance. Future flag if scale demands.
- **No use of Mem0's LLM-backed `infer: true` extraction.** Markdown is source-of-truth; we don't summarize or transform on ingest. (Mem0's own metadata says: "the deduplication system downstream will handle true duplicates" — not a fit for source-of-truth files.)
- **No graph layer (`@mem0/community`).** Out of scope for parity A/B.
- **No removal or migration of the existing `_librarian-index.sqlite`.** Both backends coexist behind the flag; users keep their index.

## File layout

```
packages/librarian/src/
├── backends/
│   ├── types.ts                         # NEW — LibrarianBackend interface
│   ├── sqlite-vec-backend.ts            # NEW — adapter over the existing index-store + retrieve
│   ├── mem0-backend.ts                  # NEW — Mem0 OSS adapter (this design)
│   └── mem0-backend.DESIGN.md           # this doc
├── (existing files unchanged: cli.ts, embed.ts, index-builder.ts, index-store.ts,
│  index.ts, prepend-cli.ts, prepend.ts, retrieve-cli.ts, retrieve.ts,
│  source-readers.ts, types.ts)
└── tests/                               # existing tests pass; new tests added below
```

The existing top-level functions (`buildIndex`, `retrievePrecedent`, `prependPrecedent`) become thin dispatchers that pick the right backend based on `opts.backend`. Their internals delegate to one of the two backend modules. **No top-level export is removed or renamed.**

## The `LibrarianBackend` interface

```ts
// packages/librarian/src/backends/types.ts
import type { Embedder, FsReader, PrecedentKind, SourceFile } from '../types.js';
import type { RetrievedPrecedent } from '../retrieve.js';

export type LibrarianBackendName = 'sqlite-vec' | 'mem0';

export interface BackendBuildInput {
  /** Eligible files discovered by source-readers (already classified by kind). */
  sources: SourceFile[];
  /** Embedder bound to Ollama (or a fake for tests). */
  embed: Embedder;
  /** File reader (so tests can mock the filesystem). */
  fsReader: FsReader;
  /** Maximum bytes of UTF-8 content to send to the embedder per file. */
  embedInputMaxBytes: number;
  /** Logger sink. */
  log: (msg: string) => void;
  /** Clock. */
  now: () => number;
}

export interface BackendBuildResult {
  embeddedNew: number;
  reusedUnchanged: number;
  removedStale: number;
  failedEmbed: number;
  byKind: Record<string, number>;
  /** Absolute path of whatever the backend persists at (for status reporting). */
  indexPath: string;
}

export interface BackendQuery {
  /** Raw user prompt — backend embeds it. */
  prompt: string;
  /** Same Embedder used at build time. */
  embed: Embedder;
  /** Top-N rows to return. */
  topN: number;
  /** Minimum similarity (cosine) — backend translates to its native scoring. */
  minSimilarity: number;
  /** Optional kind filter. */
  kindFilter?: PrecedentKind | PrecedentKind[];
  /** Optional warn sink for non-fatal anomalies. */
  warn?: (msg: string) => void;
}

export interface LibrarianBackend {
  /** Stable name (matches `LibrarianBackendName`). */
  readonly name: LibrarianBackendName;
  /** Indexed location (DB path or equivalent). */
  readonly indexPath: string;
  /** Idempotently build/refresh the index from `sources`. */
  build(input: BackendBuildInput): Promise<BackendBuildResult>;
  /** Run a retrieval query. Returns sorted descending by similarity. */
  retrieve(query: BackendQuery): Promise<RetrievedPrecedent[]>;
  /** Free any resources (e.g., close the SQLite handle). Idempotent. */
  close?(): void;
}
```

## Backend #1 — `sqlite-vec-backend.ts` (the existing implementation, wrapped)

**This is a refactor wrapper, not new code.** The current `index-builder.ts` and `retrieve.ts` already do the work. We add a thin adapter that calls them and bundles the result in `BackendBuildResult` / `RetrievedPrecedent[]` shape. Constructor takes:

```ts
new BetterSqliteBackend({
  memoryDir: string,           // CAIA default: ~/Documents/projects/caia/agent/memory
  dbPath?: string,             // override (tests)
})
```

Behaviour: identical to today. SHA+mtime change detection. Truncate to 4 KB UTF-8. JS-side cosine. Same `_librarian-index.sqlite` file. Same `precedent` table schema. Same exit codes from `buildIndex` (since it's literally the same code beneath).

> Naming note: the directive calls this "sqlite-vec backend" because that's how the campaign brief framed Phase 1. The actual implementation is **better-sqlite3 + JS-side cosine** (no sqlite-vec extension) — see the README's "Why JS-side cosine, not sqlite-vec" section. We keep the public flag name `'sqlite-vec'` for callsite stability but the class name is `BetterSqliteBackend` to reflect reality. The DESIGN clarifies this so future readers don't go hunting for an sqlite-vec dep that isn't there.

## Backend #2 — `Mem0Backend` (this is the new work)

### Constructor (Option E shape)

```ts
new Mem0Backend({
  // Storage location — defaults to <memoryDir>/_librarian-mem0-index.sqlite
  // (kept inside memoryDir per Librarian convention, NOT ~/.mem0)
  vectorStoreDbPath?: string,

  // History DB (Mem0's audit log) — defaults to <memoryDir>/_librarian-mem0-history.sqlite
  historyDbPath?: string,

  // userId partition for Mem0's required {user|agent|run}Id filter.
  // Defaults to 'caia-librarian'. Tests use 'fixture-corpus'.
  userId?: string,

  // Embedder config — Mem0 instantiates its own Ollama client; we don't
  // share Librarian's `Embedder` closure because Mem0 expects a config
  // object. We pass through the URL + model.
  ollamaUrl?: string,             // default 'http://127.0.0.1:11434'
  embedModel?: string,             // default 'nomic-embed-text'
  embedDim?: number,               // default 768

  // LLM is unused at runtime (we always pass infer:false), but the
  // Memory constructor accepts an llm config and we provide one to
  // suppress the model-existence-check warning. Same Ollama URL.
  extractionModel?: string,        // default 'qwen2.5-coder:7b' — never actually called

  // Truncation cap before handing content to Mem0. Same as Librarian default.
  embedInputMaxBytes?: number,     // default 4096

  // Test seam: inject a fake Memory instance.
  memoryFactory?: (config: unknown) => Mem0Memory,
})
```

**Why every parameter has a default:** Option E rule #3 — every CAIA-specific value (URLs, model names, DB paths, partitioning IDs) is a constructor parameter with a CAIA default. Tests injecting a `fixture-corpus` userId + a fake `memoryFactory` exercise the parameterised shape.

### `build(input)` semantics

Per source file:
1. Read file content via `fsReader.readFile(src.path)`.
2. Compute SHA-256 of full content (same as Librarian today).
3. Skip-or-update logic:
   - Check if a Mem0 row exists for this file: `await mem.search(src.path, { filters: { user_id, source_path: src.path }, limit: 1 })`.
   - Compare the stored `metadata.content_sha256` against the freshly computed sha. Match → reuse, increment `reusedUnchanged`.
   - Mismatch → call `await mem.update(existingId, truncatedContent, { metadata })` (Mem0 supports update by ID).
   - Not found → `await mem.add(truncatedContent, { userId, infer: false, metadata })`.
4. Truncation: `truncateUtf8(content, embedInputMaxBytes)` — reuse existing helper.
5. Metadata payload (encoded into Mem0's `metadata` field):
   ```ts
   {
     source_path: src.path,
     kind: src.kind,
     slug: pathToSlug(src.path),
     mtime_ms: src.mtimeMs,
     content_sha256: sha,
     content_snippet: snippet(content),  // first 4 KB (display)
   }
   ```
6. After scanning all sources, run a list-all over Mem0 (`mem.getAll({ filters: { user_id }, limit: 100000 })`) and `mem.delete(id)` any row whose `metadata.source_path` is no longer in the seen-set. This is the Librarian "removeStale" path.
7. Compute `byKind` from the final list.

`build()` is async and may run thousands of `add()` calls. We **do not parallelize** in v1 — Ollama embedding is the bottleneck, and serializing keeps the trace deterministic. Future leg can introduce a small concurrency limit (e.g., 4-way) if perf demands it.

**Failure handling:** identical contract to Librarian today. If a single file fails to embed, log + increment `failedEmbed` + continue. Do not delete the existing row for that source.

### `retrieve(query)` semantics

```ts
async retrieve({ prompt, embed, topN, minSimilarity, kindFilter, warn }): Promise<RetrievedPrecedent[]> {
  const filters: Record<string, unknown> = { user_id: this.userId };
  if (kindFilter) {
    const kinds = Array.isArray(kindFilter) ? kindFilter : [kindFilter];
    filters.kind = { in: kinds };  // Mem0 supports 'in' operator on metadata
  }
  const result = await this.memory.search(prompt, { filters, limit: topN });
  // Mem0 returns { results: [{ id, memory, score, metadata }] }
  // Map score (cosine, already 0..1) directly to similarity.
  return result.results
    .filter(r => r.score >= minSimilarity)
    .map(r => ({
      path: r.metadata.source_path,
      kind: r.metadata.kind,
      slug: r.metadata.slug,
      similarity: r.score,
      snippet: r.metadata.content_snippet,
      mtimeMs: r.metadata.mtime_ms,
    }))
    .sort((a, b) => b.similarity - a.similarity || b.mtimeMs - a.mtimeMs)
    .slice(0, topN);
}
```

Notes:
- We pass `prompt` directly to `mem.search`. Mem0 internally calls the configured embedder with the same model used at build time — no separate embed step on our side.
- `minSimilarity` defaults differ between backends: 0.4 for sqlite-vec (current Librarian default); for Mem0 we'll start with **0.25** based on probe results, then tune in Step 4. The dispatcher passes through whatever `opts.minSimilarity` the caller specifies; backends only apply backend-specific defaults when undefined.
- Mem0's filter syntax for "kind in [a,b]" is the literal `{ in: kinds }` object — confirmed in `MemoryVectorStore.matchFieldCondition`.

### `close()` semantics

Mem0's `Memory` class doesn't expose an explicit close in its public types — but `MemoryVectorStore` holds a `better-sqlite3 Database` handle internally. We call `(memory as any).vectorStore?.db?.close?.()` defensively, swallowing errors. Documented as best-effort.

## Public API surface — minimal additive change

`prependPrecedent`, `retrievePrecedent`, `buildIndex` all gain an optional `backend?: LibrarianBackendName` parameter:

```ts
// New optional field; absence preserves today's behaviour.
export interface BuildIndexOptions { ... existing ... ; backend?: LibrarianBackendName; }
export interface RetrievePrecedentOptions { ... existing ... ; backend?: LibrarianBackendName; }
export interface PrependPrecedentOptions { ... existing ... ; backend?: LibrarianBackendName; }
```

Implementation: each function constructs the appropriate backend instance and delegates.

```ts
function makeBackend(name: LibrarianBackendName, opts: BuildIndexOptions): LibrarianBackend {
  if (name === 'mem0') return new Mem0Backend({ memoryDir: opts.memoryDir });
  return new BetterSqliteBackend({ memoryDir: opts.memoryDir, dbPath: opts.dbPath });
}
```

Default is `'sqlite-vec'` everywhere. The CLIs (`caia-librarian-index|retrieve|prepend`) gain an optional `--backend mem0|sqlite-vec` flag.

## Tests

Per Option E's rule #4 ("tests inject fixture corpora"):

```
packages/librarian/tests/backends/
├── sqlite-vec-backend.test.ts   # smoke: runs the existing buildIndex flow via the new wrapper
├── mem0-backend.test.ts          # full unit coverage of Mem0Backend with a fake Memory
└── mem0-backend.fixture.ts       # in-memory fake Memory class implementing add/search/update/delete/getAll
```

The `mem0-backend.test.ts` cases:
- constructs without optional params (CAIA defaults applied)
- constructs with custom userId + dbPath (param injection works)
- `build()` over a 5-file fixture: counts match expectations; metadata correctly populated
- `build()` re-runs idempotently when sha unchanged (`reusedUnchanged` increments)
- `build()` removes vanished sources (`removedStale` increments)
- `retrieve()` honours topN + minSimilarity + kindFilter
- `retrieve()` returns empty when index is empty (graceful)
- `retrieve()` orders by similarity desc, mtime desc tiebreak

The fake `Memory` implements `add/search/update/delete/getAll` with deterministic toy embeddings (e.g., bag-of-words vectors). End-to-end CI doesn't need Ollama running.

The existing 126 tests are untouched. A small additional `tests/end-to-end.backend-flag.test.ts` verifies that `buildIndex({ ..., backend: 'mem0' })` and `buildIndex({ ..., backend: 'sqlite-vec' })` both produce non-zero `byKind` counts on the same fixture corpus — coarse parity smoke.

## Hard-constraint adherence

- ✅ **Subscription-only LLM.** Mem0 configured with `infer: false`; LLM endpoint never called. Embedder is Ollama only. No `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or any third-party key consumed.
- ✅ **Markdown is source of truth.** Mem0's `metadata.source_path` round-trips back; `RetrievedPrecedent.path` points at the markdown file. If Mem0 corrupts/loses data, rebuild from markdown via `buildIndex`.
- ✅ **Option E shape.** Private package, all paths/IDs/URLs are constructor params with defaults, fixture-tested via injected `memoryFactory`.
- ✅ **No native binary deps beyond what's already in the tree.** Mem0 OSS uses `better-sqlite3` (already a Librarian peer dep). No Qdrant/Redis/Postgres install.
- ✅ **Operator does not code.** Operator's view: a config flag to flip a backend; no IDE/CLI gymnastics required.
- ✅ **Git Flow + Evidence Gate.** Each PR squash-merged with the standard contexts.

## Step 4 A/B harness (preview)

The harness will:
1. Build both backends from the same `agent/memory` + `~/Documents/projects/reports` corpus.
2. Run 10 canonical queries (drawn from Librarian Phase-1 expected-hits if available, else hand-picked from the validation-decisions / option-E / no-API-key seam).
3. For each query record: top-3 hit identities (slug+kind), top-3 similarities, latency (ms).
4. Score: top-1 hit match (binary), top-3 hit overlap (Jaccard), latency delta.
5. Output a side-by-side markdown table at `~/Documents/projects/reports/mem0-vs-sqlite-vec-ab-2026-05-06.md`.

Verdict thresholds (committed up front so we can't move goalposts):
- **Default-flip recommendation:** Mem0 ≥ sqlite-vec on top-1 hit (≥ 9/10 match) AND latency p95 ≤ 2× sqlite-vec.
- **Parity (keep both):** Mem0 within 1 hit of sqlite-vec AND latency within 2×.
- **Regression (Mem0 not yet ready):** Mem0 misses ≥ 2 top-1 hits OR latency > 3× sqlite-vec at p95.

## Open risks / unknowns

1. **Mem0's `update()` may not preserve UUID** across retry edges. Need to verify in implementation; if not, we delete-then-add and accept history-table churn.
2. **Memory.search filter operator coverage** — confirmed `eq`, `in` are supported per `matchFieldCondition`; confirmed `gt/gte/lt/lte/ne/contains/icontains` exist. We only use `eq` (user_id) and `in` (kind).
3. **Index DB lock contention** if two Librarians run concurrently against the same `vectorStoreDbPath`. better-sqlite3 supports WAL but Mem0 doesn't enable it explicitly. We'll override post-construction: `(memory as any).vectorStore?.db?.pragma?.('journal_mode = WAL')`.
4. **Schema upgrade story.** If Mem0 ships v3.1 with a schema change, our index DB may need a wipe. Document the rebuild command in the README as the migration path: `caia-librarian-index build --backend mem0 --reset`.

## Implementation order (Step 3)

1. Create `packages/librarian/src/backends/types.ts` — pure types, no runtime.
2. Create `packages/librarian/src/backends/sqlite-vec-backend.ts` — wrap existing `buildIndex`/`retrievePrecedent` calls; tests pass against this wrapper indirectly.
3. Create `packages/librarian/src/backends/mem0-backend.ts` — full implementation against a `Mem0Memory` interface (so the fake works).
4. Create `packages/librarian/tests/backends/mem0-backend.fixture.ts` + `mem0-backend.test.ts`.
5. Add `backend?` to public option types in `index-builder.ts`, `retrieve.ts`, `prepend.ts`; route through `makeBackend()`.
6. Add `--backend` to the three CLIs.
7. Add `mem0ai` to `packages/librarian/package.json` `dependencies` (NOT devDependencies — it's a runtime path).
8. Build, lint, typecheck, test. Confirm all 126 existing + new tests pass.
9. Squash + auto-merge as `feat/librarian-mem0-002-backend-abstraction`.

## Out-of-scope follow-ups (won't be in this PR)

- Periodic rebuild scheduler (decision #4 says "weekly").
- Hybrid mode (read both backends, return union, dedup by source_path).
- Telemetry: emit `librarian.backend.choice` event so Lantern can chart the mix over time.
- Migrate `_librarian-index.sqlite` rows directly into a Mem0 row store (one-shot import) — not needed if we just re-embed; embedding is cheap.

## Sources

- `~/Documents/projects/reports/mem0-swap-investigation-2026-05-06.md` — companion investigation
- `packages/librarian/README.md`
- `packages/librarian/src/{embed,index-store,index-builder,retrieve,prepend,source-readers,types}.ts`
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E rules 1–7
- `agent/memory/feedback_no_api_key_billing.md` — subscription-only invariant
- `agent/memory/feedback_validation_decisions_2026-05-06.md` — decision #4 + Aider abort precedent
- `/tmp/mem0-probe/probe{1..5}.mjs` + `/tmp/mem0-probe/node_modules/mem0ai/dist/oss/index.mjs` — Mem0 source inspection

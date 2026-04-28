# @chiefaia/local-rag

Local-first RAG over the CAIA monorepo. Indexes source files into an embedded SQLite vector store, embeds chunks via local Ollama, returns top-K snippets in response to natural-language queries — all without a cloud round-trip.

Used by:
- `@chiefaia/local-llm-router` will route "needs context" task types through this layer (LAI-005)
- `@chiefaia/llm-cache` reuses the same embedder for semantic prompt cache lookups (LAI-004)

## Install requirements

- Ollama daemon running at `127.0.0.1:11434` (override via `OLLAMA_BASE_URL`)
- Embedding model pulled: `ollama pull nomic-embed-text`
- Node 20+ (for `Float32Array` and `node:crypto`)

## Quick start

```ts
import { LocalRag } from '@chiefaia/local-rag';

const rag = new LocalRag({ dbPath: '.local-rag.db' });

await rag.indexDirectory('./packages');
const hits = await rag.query('how does the router decide local vs claude', {
  topK: 5,
  minScore: 0.3,
});

for (const hit of hits) {
  console.log(`${hit.score.toFixed(2)}  ${hit.chunk.path}:${hit.chunk.startLine}`);
}
```

## What's in the box

| component | what it does |
|--|--|
| `Embedder` | `POST /api/embeddings` to Ollama and return a `Float32Array`. Defaults to `nomic-embed-text` (768-dim, 19ms warm on M1 Pro). |
| `chunkFile()` | Line-window chunker (60 lines, 10 overlap) with a contextual header (`[<path> L<a>-<b>]`) prepended to each chunk for better retrieval recall. |
| `VectorStore` | better-sqlite3 with one row per chunk, embedding stored as a BLOB. Brute-force cosine search over all rows on `query()`. |
| `LocalRag` | High-level façade: walks a directory, chunks every matching file, embeds and stores, then exposes `query()`. |

The store deliberately doesn't use `sqlite-vec`. For the CAIA monorepo's expected ~50–100k chunks, brute-force cosine completes in well under 100 ms on M1 Pro and avoids a native-binary dependency. LAI-008 can swap in `sqlite-vec` if the index ever crosses ~1M chunks.

## Embedding-model lock

A `meta` row stores the embedding model used to build the index. Re-opening the same db with a different `Embedder` model raises an error before any work happens — different models live in different vector spaces, and silently mixing them breaks retrieval in subtle ways. Delete the db file or pin the embedder.

## File-walk defaults

- Includes: `.ts .tsx .js .jsx .md .mdx .json .yaml .yml`
- Excludes: `node_modules .git dist build .next coverage .turbo`
- Skips files larger than 200 KB (configurable)

Override per-call via `indexDirectory(root, { include, exclude, maxFileBytes })`.

## Testing

Unit tests run with mocked `fetch` (no live Ollama needed):

```bash
pnpm --filter @chiefaia/local-rag test
```

Live smoke script (requires `nomic-embed-text` pulled and `pnpm build` first):

```bash
pnpm --filter @chiefaia/local-rag build
ROOT=./packages QUERY="how does the router decide local vs claude" \
  node packages/local-rag/scripts/smoke.js
```

Sample output on the local-rag source itself:

```
[local-rag] indexing src -> /tmp/local-rag-smoke.db
  files=5
  chunks=11, embedding...
[local-rag] indexed 11 chunks

[local-rag] query: "cosine similarity search"

  [0.556] store.ts:1-60
    [store.ts L1-60]
    // Persistent vector store backed by better-sqlite3.
    ...
```

## Performance budget (M1 Pro 16GB, April 2026)

- `nomic-embed-text` warm latency: ~19ms / chunk
- Index 50k chunks: ~16 minutes (sequential — Ollama serializes embedding calls per slot by default)
- Query (50k chunks indexed): ~50ms (embed prompt + brute-force cosine)
- Disk: ~600 MB for 50k chunks at 768-dim (Float32 + JSON metadata)

If the index walltime hurts, set `OLLAMA_NUM_PARALLEL=2` daemon-side to roughly halve embedding time.

## Roadmap

- LAI-005 wires this into the router so retrieval-style tasks ("explain this package", "where is X used") get RAG context inserted automatically.
- Reranking via `bge-reranker-v2-m3` is a candidate for v0.2 if precision-at-1 isn't tight enough on the CAIA corpus.
- AST chunking via tree-sitter is tracked under LAI-007.

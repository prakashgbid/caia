# @chiefaia/local-llm-router

LLM routing layer that dispatches CAIA tasks to either a **local Ollama model** or the **Claude API** based on task complexity and cost rules.

The goal is simple: stop paying for Claude tokens on work that a 7B-parameter local model handles just fine (classification, dedup checks, simple enrichment, status summaries) — while still routing genuinely hard work (architecture decisions, novel multi-file code, security review) to Claude.

## Why

At 1000 agent invocations/day, all-Claude routing costs roughly $600–$1,200/month. With this router pulling the simple tasks down to local Ollama, the projection is $180–$360/month — a 65–70% reduction. Ollama itself is free.

## Usage

```ts
import { route } from '@chiefaia/local-llm-router';

// Routes to local Ollama (qwen2.5-coder:7b by default).
const result = await route('domain-classification', 'user signs in with email');
console.log(result.provider); // 'local'
console.log(result.response); // 'auth'

// Routes to Claude (decomposition is too complex for a small local model).
const decomp = await route('hierarchy-decomposition', 'Build a Slack clone…');
console.log(decomp.provider); // 'claude'
```

### Options

```ts
await route('story-enrichment', prompt, {
  forceLocal: true,        // override rule, always go local
  forceClaude: true,       // override rule, always go Claude
  fallbackOnError: false,  // disable cross-provider fallback (default: true)
});
```

## Routing rules

See `src/routing-config.ts` for the full table.

- Local only: domain-classification, nature-classification, embedding-generation, dedup-check
- Local preferred (Claude as fallback): story-enrichment, test-generation-simple, code-implementation-simple, changelog-generation, status-summarization
- Claude only: hierarchy-decomposition, architecture-decision, code-implementation-complex, security-review

Unknown task types default to Claude Sonnet for safety.

## Requirements

- Ollama running on `127.0.0.1:11434` (override via `OLLAMA_BASE_URL`)
- One of the configured local models pulled (`ollama pull qwen2.5-coder:7b`, `ollama pull llama3.1:8b`)
- `ANTHROPIC_API_KEY` env var if any Claude routing is expected (including fallbacks)

The adapter pins IPv4 explicitly because on macOS `localhost` often resolves to `::1` first, and a stray IPv6 listener (e.g., an SSH tunnel) on port 11434 will silently route requests to the wrong daemon.

## Model catalog (LAI-001)

`MODEL_CATALOG` is the typed registry of every local model the router knows about — parameter count, runtime RAM, on-disk size, role, and the right endpoint to call. It does **not** drive routing decisions on its own; LAI-005 wires roles into rules.

To pull the catalog's recommended set on an M1 Pro 16GB:

```bash
ollama pull qwen2.5-coder:7b      # baseline coder (already in use)
ollama pull llama3.1:8b           # baseline generalist (already in use)
ollama pull qwen2.5-coder:14b     # bigger coder for multi-file edits
ollama pull qwen3:14b             # 14B-class generalist (chat + think:false)
ollama pull phi4                  # math/STEM specialist
ollama pull nomic-embed-text      # embeddings for RAG / cache
```

The Qwen3 caveat is now handled inside the adapter itself — the router automatically picks `/api/chat` with `think: false` for any catalog model flagged `emitsThinkingByDefault`. See `src/ollama-adapter.ts`.

## Speed tuning (LAI-002)

The Ollama adapter forwards a `keep_alive` window on every call so frequently-used models stay loaded warm in unified memory. Cold-load on a 14B model is 2-7 s on M1 Pro; warm calls are 200-300 ms. Default window: `10m`.

```bash
# Keep models loaded for an hour after the last call:
OLLAMA_KEEP_ALIVE=1h pnpm start

# Never unload (unified RAM stays committed to the model):
OLLAMA_KEEP_ALIVE=-1 pnpm start
```

Concurrent requests are governed by Ollama itself, not the router. To serve more than one in-flight request, set `OLLAMA_NUM_PARALLEL` on the daemon (not in this package's env):

```bash
# Run two requests in parallel against the same model
launchctl setenv OLLAMA_NUM_PARALLEL 2 && \
  launchctl unload ~/Library/LaunchAgents/ollama.plist 2>/dev/null
ollama serve   # picks up the new env var
```

On 16 GB unified memory, 2 is the safe ceiling for a single 14B model; pushing higher trades latency for throughput and risks the OS swapping.

### Benchmarking

```bash
pnpm --filter @chiefaia/local-llm-router run bench               # classify prompt, 3 warm runs
BENCH_PROMPT_KIND=code pnpm bench                                # code-gen prompt
BENCH_WARM_RUNS=10 pnpm bench                                    # bigger warm sample
```

Sample output on M1 Pro 16GB (April 2026):

```
tag                     role             cold  warm_p50  warm_min  warm_max   tok/s
qwen2.5-coder:7b        coder            4034       172       171       178    11.6
qwen2.5-coder:14b       coder           10496       287       269       292     7.0
llama3.1:8b             generalist       4613       208       203       208     9.6
qwen3:14b               generalist       6721       274       266       312     7.3
phi4                    reasoning        6738       252       236       426     7.9
nomic-embed-text        embeddings       1642        19        17        27 40421.1
```

Warm calls are 20-90× faster than cold — that's the value `keep_alive` unlocks. With LAI-002 in place, the practical latency gap between 7B and 14B-class models on short classification prompts collapses to ~100 ms.

## Testing

```bash
pnpm test                                # all tests; integration auto-skips when Ollama isn't up
SKIP_OLLAMA_INTEGRATION=1 pnpm test      # CI mode — skip live Ollama integration
OLLAMA_TEST_MODEL=llama3.1:8b pnpm test  # pin integration test to a specific pulled model
```

## CAIA integration

The orchestrator (`apps/orchestrator`) exposes the router via three HTTP endpoints:

- `GET /llm/rules` — return the routing rule table
- `GET /llm/rules/:taskType` — return the rule for a specific task
- `POST /llm/route` — dispatch `{ taskType, prompt }` and return the response

Smoke-test the chain end-to-end:

```bash
cd apps/orchestrator
npx ts-node scripts/e2e-llm-route.ts
```

This is a stub call site. Real agent integration (story-decomposer, classifier, etc.) lifts in follow-up PRs.

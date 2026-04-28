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

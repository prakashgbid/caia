# @caia/aiml-architect

Architect #7 of CAIA's 17-architect EA fan-out. Senior AI/ML engineer focused on prompt patterns + model selection + eval rigor for LLM applications.

## What it owns

`aiml.*` slice of the `tickets.architecture` JSONB column:

- `aiml.modelSelection` — which Claude model (Haiku|Sonnet|Opus) per call type
- `aiml.promptPatterns` — system prompt + few-shot examples + user template + refusal patterns
- `aiml.evalSuite` — eval cases + assertions + pass threshold + metric key
- `aiml.costAttribution` — cost class (T1/T2/T3), expected tokens, $/call, monthly forecast
- `aiml.aiSafetyChecks` — PII / prompt-injection / content-filter / hallucination / refusal-audit gates
- `aiml.temperaturePresets` — temperature, topP, maxOutputTokens, stop sequences per call type
- `aiml.outputSchemas` — Zod-style descriptors for structured outputs
- `aiml.cacheStrategy` — exact-cache TTL and/or semantic-cache config per call type

## What it does NOT do

No component code. No backend logic. No database schema. No CSP rules. Other architects own those concerns and the contract rejects out-of-namespace writes.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1.1). The EA Dispatcher spawns one of these per AI-touching ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

## Quick start

```ts
import { AIMLArchitect, AIMLArchitectContract } from '@caia/aiml-architect';

const architect = new AIMLArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: {} },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Apply predicate

Per V2 brief, AI/ML applies whenever the ticket touches AI/LLM concerns:

- Quality tag `ai`, `ml`, or `llm`
- Ticket type `AICall`, `LLMFlow`, or `AIWidget`
- Business requirements blob matches any of the AI keywords (LLM, GPT, Claude, chatbot, recommendation, search, embedding, vector, RAG, generative, classifier, …)

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration, cross-architect invariants, and an end-to-end golden test against a known prakash-tiwari Story ticket.

## Reuse note

The legacy `@chiefaia/aiml-architect` package's selectModel / reviewPromptPattern / ownEvalSuite / coordinateApprenticeLoop methods are *separate* cross-cutting agents and are NOT part of this V1 architect surface. Per spec §13(2), V1 only emits per-ticket specs. The cross-cutting AI/ML governance work (eval audit, prompt review, apprentice loop) is intended to land later as a separate non-architect agent.

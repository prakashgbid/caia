# @chiefaia/prompt-optimizer

Three-stage prompt optimizer that sits in front of every model call routed
through `@chiefaia/local-llm-router`. Implements the pipeline from
`reports/routing_optimizer_design_2026-05-11.md` §5.

## Pipeline

| Stage | What                                          | Cost            | When skipped                                          |
|-------|-----------------------------------------------|-----------------|-------------------------------------------------------|
| 1     | Rule-based prepass (deterministic, pure-JS)   | ~0–5 ms         | Never. Cheap and load-bearing.                        |
| 2     | Tool-output summarize via local-llm-router    | ~30–200 ms/blob | Cold-cache prompts < 500 tokens; classifier head calls|
| 3     | Token-importance prune (LLMLingua-2 inspired) | ~50–800 ms      | Classifier head calls; layer-3 verifier; short prompts|

## Usage

```ts
import { optimize } from '@chiefaia/prompt-optimizer';

const result = await optimize({
  systemPrompt: '...',
  toolOutputs: [{ id: 'tool-1', content: '...' }],
  userQuestion: 'rename Foo to Bar across the file',
  budget: { stage2Ratio: 0.4, stage3Ratio: 0.5 },
});

// result.optimizedPrompt — string to send to the executor tier
// result.metrics       — per-stage compression numbers for telemetry
```

Each stage is also exported individually under `./stage1`, `./stage2`, and
`./stage3` for unit-testing and ad-hoc invocation.

## Stages in detail

### Stage 1 — rule-based prepass

Pure JS. Deterministic. Idempotent. Operations in order:

1. Strip ANSI escapes, BOM, CRLF→LF.
2. Collapse whitespace.
3. Dedupe identical 3+ line blocks.
4. Fold long file reads (>200 lines → head/tail).
5. Truncate base64 / binary stubs.
6. Normalize JSON (sort keys, drop empty values).
7. Tag protected spans (`«protected:…»`).

### Stage 2 — tool-output summarize

Each tool-output blob is POSTed to the local router's
`/v1/chat/completions` endpoint with `model: qwen2.5-coder:7b` and a
fixed compression-style system prompt. The router handles model warmup,
caching, and tier selection.

The optimizer treats the router as opaque infrastructure — if the router
is unreachable, Stage 2 passes the blob through unchanged and records the
failure in metrics.

### Stage 3 — token-importance prune

LLMLingua-2-inspired. Where qwen2.5-coder:7b log-probabilities are
available (via the router's `/v1/embeddings` or a per-token scoring
endpoint, if mounted), tokens are scored by question-conditioned
perplexity. Where they are not, a heuristic falls back to a deterministic
TF-IDF-style score against the user question. Both paths respect
protected spans from Stage 1.

## Design reference

`~/Documents/projects/reports/routing_optimizer_design_2026-05-11.md` §5.

## Telemetry

`optimize()` returns a `metrics` object that the router persists into the
daily JSONL telemetry log. Fields match §8.1 of the design doc:

- `prompt_tokens_raw`
- `prompt_tokens_stage1` / `stage1_ms`
- `prompt_tokens_stage2` / `stage2_ms`
- `prompt_tokens_stage3` / `stage3_ms`

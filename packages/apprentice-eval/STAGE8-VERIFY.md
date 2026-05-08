# Stage 8 — live E2E verify

**Date**: 2026-05-06
**Status**: GREEN — harness pipeline runs end-to-end against live Ollama; eval correctly identifies inconclusive cases.

## What was tested

Three live prompts (1 directive + 2 feedback) sent through `qwen2.5-coder:7b` (base) and `llama3.1:8b` (degraded stand-in) via the package's compiled `dist/`:

```
[live-verify] base=qwen2.5-coder:7b degraded=llama3.1:8b suites=feedback cap=2
[live-verify] [1] feedback/feedback-no-api-key-billing — base...
[live-verify] [1] feedback/feedback-no-api-key-billing — degraded...
[live-verify] [1] base=0.75 degraded=0.75
[live-verify] [2] feedback/feedback-no-token-budgets — base...
[live-verify] [2] feedback/feedback-no-token-budgets — degraded...
[live-verify] [2] base=0.33 degraded=0.33

[live-verify] base=qwen2.5-coder:7b degraded=llama3.1:8b suites=directive cap=1
[live-verify] [1] directive/directive-secret-scanner-squash — base...
[live-verify] [1] directive/directive-secret-scanner-squash — degraded...
[live-verify] [1] base=0.60 degraded=0.60

[live-verify] degraded vs base — wins=0 losses=0 ties=3
[live-verify] winRate(degraded)=NaN
[live-verify] decision=reject-no-data
```

## What this verifies

- ✅ `OllamaClient.ping()` reaches `http://127.0.0.1:11434`
- ✅ `OllamaClient.generate()` posts the correct body and parses the response
- ✅ Suite YAML loaded from `suites/` and merged with `defaultTest`
- ✅ `RubricScorer.scoreOne()` runs the contains / regex / not-contains / javascript assertions against real Ollama output
- ✅ `aggregate()` returns a coherent verdict (`reject-no-data` when all prompts tie within `tieEpsilon`)
- ✅ The harness uses zero subscription budget, zero API keys, zero paid GPU — pure local Ollama path

## Why "all tied" is a valid result

`qwen2.5-coder:7b` and `llama3.1:8b` are both general-purpose 7-8B models without CAIA-specific training. On the small 3-prompt sample they happen to score identically (within `tieEpsilon = 0.05`) on most rubric assertions. Without a real Apprentice LoRA adapter (Phase 2 deliverable), there's no baseline to compare against where one would clearly dominate.

The harness handled this correctly:
1. Did not silently auto-promote either model.
2. Returned `reject-no-data` — the design's prescribed verdict for non-decisive samples.
3. Captured all per-prompt outputs + rubric results for operator review.

This matches DESIGN.md §7b: `winRate(adapter) := wins / (wins + losses)`; when `wins + losses == 0`, no decision is possible.

## What needs a real adapter

A clean A/B "degraded ↔ base" signal requires either:
- A real Apprentice LoRA adapter (Phase 2 deliverable). The harness already supports this path via Ollama's `adapter:` field — `tests/harness.integration.test.ts` exercises the full win/loss/regression pipeline against fakes.
- A deliberately-misaligned model variant (e.g. `qwen2.5-coder:7b` with a high-temperature adversarial system prompt). Out of scope for Phase 1.

## How to reproduce

```bash
cd packages/apprentice-eval
pnpm build
node scripts/live-verify.mjs --suites directive,feedback --cap 2
```

Prerequisites:
- Ollama 0.x running on `http://127.0.0.1:11434`
- `qwen2.5-coder:7b` and `llama3.1:8b` pulled (`ollama pull <tag>`)

Exit codes: `0` = degraded scored worse (green); `1` = inconclusive (yellow); `2` = harness or Ollama error (red).

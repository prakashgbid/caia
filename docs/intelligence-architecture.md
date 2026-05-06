# Intelligence Architecture

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §7.4.
> **Maintenance**: today Claude maintains; AI/ML Architect Agent (master sequencing item 8.5) takes over going forward.

This document codifies how CAIA picks LLMs, routes inference, falls back when constrained, manages prompts, evaluates quality, and trains adapters.

## Model selection decision tree

```
Task arrives at agent:
  │
  ▼
Is the task suitable for bulk classification / embeddings / cheap synthesis?
  │
  ├─ YES → Ollama (qwen2.5-coder:7b OR nomic-embed-text)
  │
  └─ NO  ↓
       │
       ▼
Is the task simple enough for Claude Haiku (binary --print --model haiku)?
  │
  ├─ YES → claude binary spawn with --model haiku
  │
  └─ NO  ↓
       │
       ▼
Is the task complex synthesis / architecture / non-trivial reasoning?
  │
  ├─ YES → claude binary spawn with --model sonnet OR opus
  │
  └─ NO → Default to Ollama (and surface as router improvement opportunity)

Account-pool selection (within claude binary spawn):
  │
  ▼
Is current account at <80% weekly cap?
  │
  ├─ YES → Use account-1
  │
  └─ NO  → Try account-2; if both >80%, BIAS router to Ollama
       │
       └─ If both at 100%, raise BudgetExceededError → orchestrator pause; NEVER api-key fallback
```

## Routing optimality

Tracked via Curator's Dimension 2 (Subscription-bucket Economics):

- **Ollama-vs-Claude split**: % of agent calls served by local Ollama (target: 60-70%)
- **Per-agent token attribution**: which agent consumes most subscription bucket
- **Routing optimality**: for each task class, is it on cheapest tier that meets quality bar?

## Fallback chain (when Claude unreachable)

Per ADR-007 (subscription-only LLM):

```
1. local-llm-router tries Ollama (free, 80%+ of routes)
2. If task type requires Claude OR Ollama can't satisfy:
   a. Try subscription account #1 via claude binary spawn
   b. If account #1 capped: try subscription account #2 via claude binary spawn
   c. If both capped: raise BudgetExceededError → orchestrator pause
   d. NEVER try API key
```

## Prompt management

| Layer | Where prompts live |
|---|---|
| **System prompt** | `packages/system-prompt-block/` (shipped PR #347) — auto-prepended CAIA primer ≤1K tokens |
| **Task prompts** | Agent-specific; per-package design doc |
| **Pre-spawn injection** | Mentor lessons + Librarian precedent prepended to task input |
| **In-context examples** | Librarian retrieval at spawn time |
| **Eval prompts** | `packages/prompt-evals/` + Promptfoo canonical 100-prompt suite |

## Eval harness

Per Wave 1 + Wave 3 of Enterprise Landscape directive:

- **Promptfoo** for CI-level eval — YAML-based, free, OSS.
- **Canonical 100-prompt suite** spanning all 6 tiers.
- **Apprentice's adapter rollout flow** uses Promptfoo as the eval gate.
- **DSPy** (Stanford) extends Apprentice loop in Wave 3 — compiled prompts vs eval suite; 10-40% quality lift.

## Apprentice adapter lifecycle

```
Phase 0: Corpus aggregator collects ~5-10K instruction-output pairs
Phase 1: Eval harness records baseline scores per prompt
Phase 2: First LoRA training run on Mac MLX (Qwen2.5-Coder-7B QLoRA 4-bit)
         OR cloud GPU spot ≤$50/run for 14B
Phase 3: Adapter swap in Ollama (shadow → canary 10% → full)
Phase 4: Weekly retraining cron (Sat 02:00 local)
         Continuous: Promptfoo win-rate > 60% threshold to canary
                     Win-rate > 70% sustained 3 days to full promotion
                     Instant rollback on regression
```

## DSPy integration

Today: partial adoption per `~/Documents/projects/reports/dspy-reconstitution-2026-05-03.md`. `@chiefaia/dspy-bridge` package exists.

Wave 3 expansion:
- DSPy compilation for canonical prompts (per Apprentice eval suite)
- MIPROv2 optimizer for prompt evolution
- Pairs with QLoRA adapter training (DSPy compiles the prompt; adapter learns the project voice)

## Inference cost model

| Tier | Cost | Latency | Use |
|---|---|---|---|
| Ollama-local (7B) | $0 (sunk Mac compute) | ~50-300ms | Bulk classification, embeddings, structured generation |
| claude --model haiku | Subscription bucket | ~500ms-2s | Lightweight synthesis |
| claude --model sonnet | Subscription bucket | ~1-5s | Moderate complexity |
| claude --model opus | Subscription bucket | ~3-15s | Top-tier reasoning |
| Cloud GPU (training only) | ≤$50/run cap | per-job | Apprentice 14B training |

## Subscription cap behaviour

- **<80% weekly cap**: route freely to claude binary.
- **80-99% weekly cap**: bias router toward Ollama; still allow critical-path Claude calls.
- **100% weekly cap**: BudgetExceededError → orchestrator pause; wait for cap reset (weekly).
- **NEVER**: fall back to API-key billing (per ADR-007).

## Re-evaluation triggers

1. **Apprentice adapter consistently wins** ≥10% on canonical eval → re-evaluate router default to prefer adapter for in-domain tasks.
2. **Subscription-bucket exhaustion** sustained >7d cumulative over 4-week window → re-evaluate adding third subscription.
3. **New model class** (e.g., a Claude tier between haiku and sonnet) → update routing decision tree.
4. **Cloud GPU spot pricing** drops materially → re-evaluate fine-tuning frequency.

## See also

- [`adr/ADR-007-subscription-only-llm.md`](adr/ADR-007-subscription-only-llm.md) — billing constraint
- [`adr/ADR-008-mac-first-inference.md`](adr/ADR-008-mac-first-inference.md) — routing default
- `agent/memory/feedback_no_api_key_billing.md` — standing rule
- `agent/memory/feedback_minimal_cloud_gpu_allowed.md` — cloud GPU carve-out
- `agent/memory/apprentice_agent_directive.md` — Apprentice phases
- `agent/memory/enterprise_ai_landscape_directive.md` — Promptfoo + DSPy waves
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §7.4 — full audit

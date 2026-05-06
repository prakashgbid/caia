# ADR-007 — Subscription-only LLM billing (no API keys)

## Status

**Accepted** — operator-authorised standing rule. HARD constraint.

## Context

Anthropic LLM access is consumed in two billing modes: pay-as-you-go API keys (per-token billing, no cap) vs. subscription (Pro / Max plans, weekly cap, no per-token cost). API-key billing is unbounded; a runaway agent could rack up arbitrary spend. Subscription is bounded — when the cap is hit, claude binary returns budget-exceeded; the orchestrator pauses and waits for cap reset.

CAIA runs ≥10 agents continuously plus interactive Cowork sessions. Without spend bounds, a single misconfigured loop or runaway recursion could exhaust thousands of dollars in hours. With API keys this is undetectable until the bill arrives. With subscription it is automatically halted by the provider.

Cloud GPU rental for training (a different category) is permitted at minimal level (`feedback_minimal_cloud_gpu_allowed.md`). This ADR covers per-token LLM API billing only.

## Decision

LLM access is via subscription only. No API keys. Specifically:

- **Allowed**: `claude` binary subprocess spawn (uses subscription auth from `~/.claude/`)
- **Allowed**: Ollama HTTP at `localhost:11434` (free, local)
- **Allowed**: cloud GPU rental for training, $50/run + $200/month cap (per `feedback_minimal_cloud_gpu_allowed.md`)
- **NOT allowed**: Anthropic API key billing (`ANTHROPIC_API_KEY` env var)
- **NOT allowed**: OpenAI / Replicate / any per-token paid API for production agents
- **NOT allowed**: Anthropic SDK with API-key auth in any agent code path

When subscription cap exhausts: pause orchestrator, wait for reset (weekly), resume. NEVER fall back to API-key spend.

Account-pool design: 2 Max subscriptions today; eventually 1 Pro 20x. Tenants in productisation phase BYOK (their own subscriptions).

## Consequences

**Positive:**
- Spend is bounded by subscription cap (predictable monthly cost).
- Runaway agents cannot exceed cap (Anthropic enforces).
- Spend Guard package (`@chiefaia/spend-guard`) tracks usage in real time and pauses proactively before hard cap.
- Ollama bears 60-70% of bulk inference at $0 marginal cost.

**Negative:**
- Subscription cap can pause the system for hours-to-days (acceptable trade-off).
- No "burst capacity" — cannot pay-as-you-go during high-pressure sprint.
- claude binary subprocess overhead (vs. SDK) is minor but non-zero.

**Neutral:**
- Productisation will re-introduce API-key paths for tenant BYOK — but tenants pay their own bill.

## Enforcement

- `@chiefaia/spend-guard` 4-tier caps: task $1.50/day, project $30/week, global-day $25, global-week $100.
- 80%-of-cap threshold biases router toward Ollama (reduces Claude usage proactively).
- Steward semgrep rule blocks `ANTHROPIC_API_KEY` references in production code paths.
- Code review: any PR adding API-key auth must explicitly justify and tag `@chiefaia/billing-exception`.

## Re-evaluation triggers

1. **Productisation** — tenant BYOK requires API-key support. Re-evaluate at first paying tenant.
2. **Subscription cap inadequate** — if the cap halts critical work for >7d cumulatively over a 4-week window, re-evaluate adding a third subscription.

## References

- Standing rule: `agent/memory/feedback_no_api_key_billing.md`
- Cloud GPU carve-out: `agent/memory/feedback_minimal_cloud_gpu_allowed.md`
- Implementing package: `@chiefaia/spend-guard`
- MCP allowlist + sanitizer: `agent/memory/safety_hardening_2026-04-29.md`
- Companion: ADR-008 (Mac-first inference), ADR-010 (4-layer safety stack)

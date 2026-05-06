# ADR-008 — Mac-first inference (Ollama bulk + claude binary synthesis)

## Status

**Accepted**.

## Context

CAIA has many tasks per day across many agent classes. Most are not synthesis-grade — they are classification, embeddings, simple extraction, lookups. Sending every task to Claude is wasteful in two dimensions: subscription bucket consumption (per ADR-007) and latency (network round-trip vs. local-first).

Operator runs a Mac M1 Pro 16GB. This is comfortably above the threshold for running Qwen2.5-Coder-7B and embedding models at usable latencies. The 14B and 32B models exceed RAM with concurrent worktrees but are reachable via cloud GPU spot for occasional heavy work (per `feedback_minimal_cloud_gpu_allowed.md`).

Industry SOTA on routing (Cursor, Augment Code, Cognition) consistently uses cheap-local-first → escalate-to-frontier pattern. Local LLM-router shipped at `@chiefaia/local-llm-router` already supports the routing decision tree.

## Decision

LLM inference is routed in this order:

1. **Ollama-local first** (free, on-Mac):
   - `qwen2.5-coder:7b` for code-adjacent classification + structured generation
   - `nomic-embed-text` for embeddings (FREG, AKG, Mentor, Librarian)
   - Target: 60-70% of agent calls served locally

2. **claude binary spawn** for synthesis tasks:
   - `--model haiku` for lightweight synthesis
   - `--model sonnet` for moderate complexity
   - `--model opus` for top-tier reasoning

3. **Account-pool routing** within claude binary:
   - account-1 if <80% weekly cap; else account-2
   - if both >80%: bias router to Ollama
   - if both 100%: BudgetExceededError → orchestrator pause (per ADR-007, never API-key fallback)

4. **Cloud GPU** for training only (Apprentice phase) at $50/run cap.

Routing decision tree lives in `agent/memory/caia_architecture.md` §intelligence-architecture and `caia/docs/intelligence-architecture.md`.

## Consequences

**Positive:**
- 60-70% reduction in Claude subscription consumption (Ollama bears bulk).
- Lower latency for short tasks (no network).
- Resilient to Anthropic outages (Ollama keeps embedding + classification flowing).
- Free baseline — adding compute is free (Mac is sunk cost).

**Negative:**
- 16GB RAM caps concurrent Ollama models — adapter swap requires careful scheduling.
- Local model quality lags frontier; requires Apprentice LoRA fine-tuning to close the gap on CAIA-specific tasks.
- Routing bug → wrong model picked → quality regression. Mitigated by Promptfoo CI gate and Curator routing-optimality dimension.

**Neutral:**
- Future productisation may push some inference to cloud-GPU per-tenant; routing tree extends, decision pattern unchanged.

## Routing optimality measurement

Tracked via Curator Dimension 2 (Subscription-bucket Economics):
- Ollama-vs-Claude split per agent class
- Per-agent token attribution
- Routing optimality — for each task class, is it on the cheapest tier that meets the quality bar?

## References

- Standing rule: `agent/memory/feedback_no_api_key_billing.md`
- Implementing packages: `@chiefaia/local-llm-router`, `@chiefaia/spend-guard`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §7.4
- Apprentice LoRA fine-tuning: `agent/memory/apprentice_agent_directive.md`
- Companion ADRs: ADR-007 (subscription-only), ADR-009 (custom Hono runtime)

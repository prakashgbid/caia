---
title: Consumption probe report — 2026-05-15
date: 2026-05-15
generated_by: caia/packages/chain-runner/bin/consumption-probe.js
---

# Consumption probe — 2026-05-15

Scanned **73** workspace packages.

- LIVE: 32
- DORMANT: 41

## Drift — newly dormant since last probe

- `@chiefaia/aiml-architect`
- `@chiefaia/analytics`
- `@chiefaia/apprentice-eval`
- `@chiefaia/apprentice-training`
- `@chiefaia/behavior-suite`
- `@chiefaia/code-reviewer`
- `@chiefaia/config`
- `@chiefaia/critic`
- `@chiefaia/curator`
- `@chiefaia/dead-shell-detector`
- `@chiefaia/decomposer-recursive`
- `@chiefaia/dev-inspector`
- `@chiefaia/guardrails-validator`
- `@chiefaia/image-provider`
- `@chiefaia/llm-cache`
- `@chiefaia/local-llm-router-mcp`
- `@chiefaia/local-llm-router-py-client`
- `@chiefaia/local-rag`
- `@chiefaia/mentor-fastpath`
- `@chiefaia/metrics`
- `@chiefaia/orchestrator-elevate`
- `@chiefaia/playwright-config`
- `@chiefaia/prompt-evals`
- `@chiefaia/researcher`
- `@chiefaia/reviewer`
- `@chiefaia/secrets-broker`
- `@chiefaia/skills-registry`
- `@chiefaia/steward-core`
- `@chiefaia/stolution-dispatch`
- `@chiefaia/story-decomposer`
- `@chiefaia/surface`
- `@chiefaia/system-prompt-block`
- `@chiefaia/test-isolation`
- `@chiefaia/test-kit`
- `@chiefaia/tracing`
- `@chiefaia/verifier`
- `@pokerzeno/backend-core`
- `@pokerzeno/cast-bridge`
- `@pokerzeno/content-engine`
- `@pokerzeno/integrity-check`
- `@pokerzeno/seo-runner`

## Dormant packages (sorted by days-silent)

### @chiefaia/analytics

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Shared GA4 analytics, consent management, and event taxonomy for Pokerzeno sites

### @pokerzeno/backend-core

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Shared Supabase backend for RouletteCommunity and PokerZeno

### @chiefaia/behavior-suite

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Behavioral / functional / layout testing foundation for pokerzeno sites

### @chiefaia/config

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Validated runtime configuration loading

### @pokerzeno/content-engine

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: `content`
- purpose: Automated content generation for PokerZeno and Roulette Community

### @chiefaia/dead-shell-detector

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: _(no description)_

### @chiefaia/dev-inspector

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Dev-only React element inspector: hover outline, stable fiber IDs, click-to-copy

### @chiefaia/image-provider

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: `image-provider`
- purpose: Supply real photo-quality imagery to roulette-community and poker-zeno sites

### @pokerzeno/integrity-check

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: `integrity`
- purpose: Link & Action Integrity checker for Next.js sites. Guarantees zero broken links and zero dead click handlers.

### @chiefaia/local-rag

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Local-first RAG over the CAIA monorepo — Ollama embeddings + SQLite vector store, no cloud calls.

### @chiefaia/metrics

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Prometheus-compatible application metrics

### @chiefaia/secrets-broker

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: `secrets`
- purpose: _(no description)_

### @pokerzeno/seo-runner

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: `seo-runner`
- purpose: SEO audit engine for pokerzeno.com and roulettecommunity.com

### @chiefaia/story-decomposer

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: _(no description)_

### @chiefaia/test-kit

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: Test utilities, mocks, and fixtures for CAIA packages

### @chiefaia/tracing

- last-modified: 2026-04-30
- days-silent: 15
- last-importer-seen: never
- bins: _(none)_
- purpose: OpenTelemetry distributed tracing

### @chiefaia/skills-registry

- last-modified: 2026-05-01
- days-silent: 14
- last-importer-seen: never
- bins: _(none)_
- purpose: Foundational typed registry for agent skills (capabilities). Lets agents declare what they can do, lets the orchestrator query/match by capability + tags + cost class, and provides an in-memory store with discriminated-union manifest schema (Zod) for runtime validation.

### @chiefaia/decomposer-recursive

- last-modified: 2026-05-03
- days-silent: 12
- last-importer-seen: never
- bins: _(none)_
- purpose: Recursive PO decomposition engine — scope detector + atomicity classifier + per-scope decomposers + MECE judge pair.

### @chiefaia/playwright-config

- last-modified: 2026-05-04
- days-silent: 11
- last-importer-seen: never
- bins: _(none)_
- purpose: Shared Playwright config factory for the Fix-It Test Agent — local workers + remote Browserless mode

### @chiefaia/steward-core

- last-modified: 2026-05-04
- days-silent: 11
- last-importer-seen: never
- bins: _(none)_
- purpose: DevOps Steward Agent — process-graph evaluator (propose-only, P0). Codifies post-release back-merge expectation as the first watcher; foundation for the continuous-compliance Steward.

### @chiefaia/test-isolation

- last-modified: 2026-05-04
- days-silent: 11
- last-importer-seen: never
- bins: _(none)_
- purpose: Per-test ephemeral SQLite + isolated localhost ports for parallel test runs

### @chiefaia/curator

- last-modified: 2026-05-05
- days-silent: 9
- last-importer-seen: never
- bins: `caia-curator`
- purpose: Curator Phase-2 — daily-running CAIA agent that scans the platform across measurable quality dimensions and emits both a daily digest of findings AND an action layer (PR proposals, backlog directives, alarms, industry briefings) per the curator_agent_directive output modes 5-8. Phase-2 PR-1 ships the action types + findings-to-actions classifier + alarm emitter; PR-2 adds PR-proposal + backlog-directive emitters; PR-3 adds the industry-briefing scanner + a unified caia-curator act runner.

### @chiefaia/prompt-evals

- last-modified: 2026-05-06
- days-silent: 9
- last-importer-seen: never
- bins: `caia-prompt-evals`
- purpose: Promptfoo-based eval suites for CAIA agent prompts. Wave 1.2 of the Enterprise Wave 1 campaign per agent/memory/enterprise_ai_landscape_directive.md (W1-2). Ships YAML test suites for the PO, BA, EA, Validator, Test-Design, Coding, Fix-It, Steward, Mentor, and Curator subagents along with a deterministic local provider so the CI eval check runs free + fast (no LLM API key required). Optional Ollama provider lets operators run live-LLM evals locally.

### @chiefaia/system-prompt-block

- last-modified: 2026-05-06
- days-silent: 9
- last-importer-seen: never
- bins: `caia-system-prompt-block`
- purpose: Option E codification — generates a stable, deterministic, ≤1K-token CAIA primer block to prepend to every spawned agent's system prompt. Reads the standing-instructions section of agent/memory/MEMORY.md, the table-of-contents of caia_architecture.md, and the 10-stage Definition-of-Done out of master_backlog_sequencing_2026-05-05.md, codegens a stable markdown digest, asserts the token budget, and exposes both a CLI (caia-system-prompt-block) and a parameterised generateCaiaPrimer() function that follows Option E shape (every CAIA-specific path is a constructor parameter with a CAIA default).

### @chiefaia/aiml-architect

- last-modified: 2026-05-08
- days-silent: 7
- last-importer-seen: never
- bins: `caia-aiml-architect`
- purpose: AI/ML Architect Agent — first of 12 domain-specialist architect agents (item 8.5 in master sequencing). Unifies scattered AI/ML decisions across CAIA into a coherent practice: model selection (Claude / Ollama / Apprentice adapters), prompt-pattern review, canonical eval suite ownership, and Apprentice loop coordination. Serves OTHER agents (EA, Coding, Fix-It, Critic) — operator never invokes directly. No runtime LLM calls — pure analysis over injected state from local-llm-router (model catalog + routing rules), mentor-event-bus (failure events), and the Apprentice corpus + adapter registry. Ships in Option E shape — private workspace package, parameterised constructor with CAIA defaults, fixture-corpora-tested, never published.

### @pokerzeno/cast-bridge

- last-modified: 2026-05-08
- days-silent: 7
- last-importer-seen: never
- bins: _(none)_
- purpose: Reusable casting utility for PokerZeno and Roulette Community — BroadcastChannel two-tab sync + Chrome tab-mirror casting

### @chiefaia/orchestrator-elevate

- last-modified: 2026-05-08
- days-silent: 7
- last-importer-seen: never
- bins: `orchestrator-elevate-bootstrap`
- purpose: Root-owned sudo wrapper + scoped Vault AppRole for permanent Cowork orchestrator privilege escalation on stolution. Single NOPASSWD entry point with exhaustive allowlisting and JSONL audit logging.

### @chiefaia/stolution-dispatch

- last-modified: 2026-05-08
- days-silent: 7
- last-importer-seen: never
- bins: _(none)_
- purpose: MCP tool wrapper for spawning remote Claude Code workers on stolution via SSH

### @chiefaia/guardrails-validator

- last-modified: 2026-05-10
- days-silent: 5
- last-importer-seen: never
- bins: _(none)_
- purpose: Layer-2 input/output validation for agent LLM calls. Pure-TS, all-local, no API keys, no Python bridge. Composable validator profiles (untrusted-user-input, inter-agent, pre-publish, tool-call-args). Catches PII / secrets / prompt injection / system-prompt leakage at the agent-prompt boundary BEFORE the LLM call and at the response boundary BEFORE downstream consumption. Layered behind capability-broker and ABOVE tool-output-sanitizer in the 4-layer safety stack.

### @chiefaia/surface

- last-modified: 2026-05-09
- days-silent: 5
- last-importer-seen: never
- bins: `caia-surface`
- purpose: Surface Agent — operator-curation lens. Filters and digests important findings from PR activity, agent-memory deltas, and agent transcripts so the operator gets a curated 'what matters this week' view rather than a firehose. Tier-A item 11 of agent_ecosystem_expansion_directive.md. Option E shape — private workspace package, parameterised constructor, fixture-tested, never published.

### @chiefaia/apprentice-training

- last-modified: 2026-05-14
- days-silent: 1
- last-importer-seen: never
- bins: `caia-apprentice-training`
- purpose: Apprentice Phase 2 — LoRA training pipeline. Reads `@chiefaia/apprentice-corpus` manifest + samples.jsonl, splits into train/valid/test (honouring the corpus manifest's deterministic holdout when present), writes MLX-LM-formatted JSONL to a working dir, spawns `python -m mlx_lm.lora` as a subprocess to run QLoRA training of a 4-bit-quantised 7B base on Mac M-series, and emits a date-stamped adapter directory containing `adapters.safetensors` + `adapter_config.json` + a training-log + a wrapper metadata file. Mac MLX is the primary path; cloud-GPU rental is allowed at minimal level (per `feedback_minimal_cloud_gpu_allowed.md`) when Mac can't fit the workload, with a $50/run cap that escalates to operator above. Subscription-only LLM cost: no API-key billing anywhere; MLX uses local quantised weights, no remote LLM calls. Ships in Option E shape — private workspace package, fully parameterised constructor with CAIA defaults, fixture-corpora-tested with a mocked subprocess, never published.

### @chiefaia/mentor-fastpath

- last-modified: 2026-05-14
- days-silent: 1
- last-importer-seen: never
- bins: `caia-mentor-fastpath`, `caia-postmerge-watcher`, `caia-postmerge-consumer`
- purpose: Mentor Phase-1 reactive fast-path + Phase-2 postmerge data layer + Phase-2 postmerge watcher daemon + Phase-2 postmerge consumer. Phase 1 subscribes to OperatorCorrection events and writes proposals. Phase 2 polls 'gh pr list' / 'gh run list' for postmerge regressions, emits events into the bus, and a separate consumer translates those events into proposals via the same memory-writer.

### @chiefaia/apprentice-eval

- last-modified: 2026-05-15
- days-silent: 0
- last-importer-seen: never
- bins: `caia-apprentice-eval`
- purpose: Apprentice Phase 1 — eval harness. Scores the Apprentice base model + each candidate LoRA adapter against a canonical YAML prompt suite (hand-curated CAIA-vocabulary prompts + corpus-holdout + Mentor-incident-derived). Produces a deterministic per-prompt score-card, pairwise win-rate vs the base model, and a regression flag set that disqualifies adapters from canary if they regress on prompts the base previously passed. Reaches Ollama via /api/generate (with mlx_lm subprocess fallback if the installed Ollama version doesn't support adapter loading) and optionally invokes the local `claude` binary as a tied-output judge — subscription-only (ANTHROPIC_API_KEY explicitly cleared from the spawned env) and bounded by judgeBudget. Operator-blind A/B mode lets the operator contribute preferences for ambiguous outputs back into the next training corpus. Ships in Option E shape — private workspace package, fully parameterised constructor with CAIA defaults, fixture-tested, never published.

### @chiefaia/code-reviewer

- last-modified: 2026-05-15
- days-silent: 0
- last-importer-seen: never
- bins: `caia-code-reviewer`
- purpose: Blocking PR code-review agent — runCodeReview({prRef,repoPath}) → {verdict, findings}. Reviews correctness, bugs, style, type safety, test coverage, naming, comments. Sibling to @chiefaia/critic (security/regression/cost) and @chiefaia/reviewer (advisory craftsmanship). One of the two AI reviewers required by branch protection per operator_decisions_2026-05-08.md. Subscription-only LLM via claude --print. Option E shape — private workspace package, parameterised constructor, fixture-tested.

### @chiefaia/critic

- last-modified: 2026-05-15
- days-silent: 0
- last-importer-seen: never
- bins: `caia-critic`
- purpose: Pre-commit adversarial review agent. Reads PR diffs, runs deterministic pattern detectors plus LLM-reasoned adversarial review (claude binary, subscription-only) against Mentor's 18-category failure-mode taxonomy, files findings as PR comments. Steward consumes blocking findings (severity >= high). Tier-A item 9 of agent_ecosystem_expansion_directive.md. Option E shape — private workspace package, parameterised constructor, fixture-tested.

### @chiefaia/llm-cache

- last-modified: 2026-05-14
- days-silent: 0
- last-importer-seen: never
- bins: _(none)_
- purpose: Two-tier prompt cache (exact + semantic) for the local LLM router. Sqlite-backed, embedder-pluggable. Ships an L6 cascade-tier preset (24h TTL, 0.92 cosine threshold) backed by nomic-embed-text via Ollama.

### @chiefaia/local-llm-router-mcp

- last-modified: 2026-05-14
- days-silent: 0
- last-importer-seen: never
- bins: `caia-local-llm-router-mcp`
- purpose: MCP stdio server that exposes the local-llm-router daemon as 5 Cowork tools (local_classify, local_summarize, local_draft, local_format, local_search_memory).

### @chiefaia/local-llm-router-py-client

- last-modified: 2026-05-14
- days-silent: 0
- last-importer-seen: never
- bins: _(none)_
- purpose: Python client + B15.C v2 spawn prompt template + SPS-α claude-argv builder (headroom-wrap + KV-cache prefix stabilization). Vendored into claude-spawner-agent on M1+M3+stolution. Pure stdlib (no pip deps); HTTP via urllib; schema validation via stdlib re/json.

### @chiefaia/researcher

- last-modified: 2026-05-15
- days-silent: 0
- last-importer-seen: never
- bins: `caia-researcher`
- purpose: Researcher Agent — on-demand deep-dive technology evaluation. Decomposes a query into sub-questions, fetches multi-source evidence (WebSearch + WebFetch + Librarian precedent), spawns the claude binary (subscription-only) for synthesis, and emits a structured markdown report with citations matching the shape of the four canonical CAIA research reports. Tier-A item 10 of agent_ecosystem_expansion_directive.md. Option E shape — private workspace package, parameterised constructor, fixture-tested. Distinct from Critic (adversarial review of EXISTING code), Reviewer (craftsmanship review), Curator (daily breadth scan), Librarian (project-corpus retrieval).

### @chiefaia/reviewer

- last-modified: 2026-05-15
- days-silent: 0
- last-importer-seen: never
- bins: `caia-reviewer`
- purpose: Craftsmanship-focused PR review agent. Reads PR diffs, runs deterministic pattern detectors plus LLM-reasoned craftsmanship review (claude binary, subscription-only) for readability/idiom/maintainability dimensions, and files advisory findings as PR comments. Reviewer findings are NEVER blocking — Steward consumes only Critic blockers. Tier-A item 9.5 of agent_ecosystem_expansion_directive.md. Option E shape — private workspace package, parameterised constructor, fixture-tested.

### @chiefaia/verifier

- last-modified: 2026-05-15
- days-silent: 0
- last-importer-seen: never
- bins: `caia-verifier`
- purpose: VERIFIER review-sibling — fourth sibling alongside Critic, Code-Reviewer, Reviewer. Spawns a fresh-prompt, fresh-worktree claude binary that re-derives acceptance-criteria/test/file-scope verdicts from the actual diff and emits a strict-JSON verdict. BLOCKING for autonomous-loop spawns (gates `nodes.status='done'` via SPS done_status_guard trigger), ADVISORY for operator-routed spawns. Subscription-only — never sets ANTHROPIC_API_KEY.


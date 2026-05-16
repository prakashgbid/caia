# SPS Prompting Runbook

**Document:** `caia/docs/sps-prompting-runbook.md`
**Owner:** SPS lane (Smart Prompting System)
**Last revised:** 2026-05-16
**Acceptance bar:** ≥ 70 % displacement on `canonical-suite-v2`

The Smart Prompting System (SPS) is the *heart of CAIA*. Every chat request
issued anywhere in the CAIA fleet flows through `local-llm-router`, which
decides whether a local Ollama tier handles it (preferred) or whether the
request escalates to Claude or the stolution-batch tier. This runbook is the
single source of truth for operators running, tuning, and recovering the
prompting pipeline.

## 1. Architecture

```
caller (claude-wrap | claude-spawner | any CAIA agent)
    │  POST /v1/chat/completions { model: "auto", messages: [...] }
    ▼
local-llm-router (Node service @ 127.0.0.1:7411, plist
                  com.chiefaia.local-llm-router)
    │
    ├── (1) classifier-v2  (keyword-prepass → LLM-path via classifier_model)
    │       outputs { intent, confidence, recommended_tier, needs_escalation }
    │
    ├── (2) tier-policy    (routing-rules.yaml maps intent → tier;
    │                       per-tier guardrails + budget gates apply)
    │
    ├── (3) prompt-optimizer  (3-stage: prepass / compress / rephrase;
    │                          template-token-leak fix R-3 lives here)
    │
    └── (4) dispatcher
              │
              ├── Ollama @ 127.0.0.1:11434  (local-7b / local-13b / local-32b)
              ├── stolution-batch @ 100.90.12.37  (qwen2.5-coder pulls)
              └── claude binary (cloud-haiku / cloud-sonnet / cloud-opus)
```

The router is a single Node process. It exposes:

- `POST /v1/chat/completions` — OpenAI-compatible chat completions.
  Response includes a `caia` block carrying provider, duration, advisory
  hint, and RAG metadata.
- `GET /healthz` — health probe (router version, ollama state, classifier
  model, RAG index status).
- `POST /admin/warmup` — added by RR-3; per-model warm tracking; idempotent.
- `POST /v1/optimize` — *not yet wired* (Phase 7 note); the 3-stage prompt
  optimizer is invoked inline by the dispatcher today.

## 2. Tiers

| Tier ID | Backend | Typical intent | Notes |
|---|---|---|---|
| `local-7b` | Ollama `qwen2.5-coder:7b` | classify, summarize, rename, format, lint-fix, draft-prose, fill-template, memory-search | Default classifier model. Warmed on daemon start. |
| `local-14b` | Ollama `qwen2.5-coder:14b` | medium-code, doc-write, spec-check, review-prose | Medium-cost local; warmed lazily. |
| `local-32b` | Ollama `qwen2.5-coder:32b` | hard-code (deep multi-file reasoning) | Slow cold-start; pre-warm via `/admin/warmup` before a heavy session. |
| `stolution-batch` | qwen2.5-coder pulls on stolution box (100.90.12.37) | batch-summarize, corpus-distill, embedding-generate | Async/long-running; landed in GB-12 (PR #477). |
| `cloud-haiku` | `claude --model haiku` | clarification on ambiguous intent (confidence < 0.5) | Fast escalation when classifier is uncertain. |
| `cloud-sonnet` | `claude --model sonnet` | reason-over-context, new-design | Default cloud tier for non-trivial escalations. |
| `cloud-opus` | `claude --model opus` | architect-level multi-system design | Used sparingly; expensive. |
| `reject` | none | prompt-injection, empty-input, policy-violating prompts | Router returns `route-failed` with an explanatory message. |

Suite-tier ↔ router-tier equivalence (see `evals/run_canonical_suite_v2.py`):
the suite was authored against the capability ladder (`local-3b/7b/13b`);
the router only exposes realized backends, so `local-3b ≈ local-7b` and
`local-13b ≈ local-14b` for accuracy scoring.

## 3. Operator commands

Every command below assumes you are on M3 (the operator's primary box) with
`caia/` checked out at `~/Documents/projects/caia`.

### Daemon control

```sh
# Health + classifier state + ollama models + RAG index entries
curl -s http://127.0.0.1:7411/healthz | jq .

# Warm a model (idempotent; cold-start fix RR-3)
curl -s -X POST http://127.0.0.1:7411/admin/warmup \
     -H 'Content-Type: application/json' \
     -d '{"model":"qwen2.5-coder:7b"}'

# Reload after a router code change (develop merge → post-merge auto-kickstart
# normally handles this; manual:)
launchctl kickstart -k gui/$(id -u)/com.chiefaia.local-llm-router

# Tail the router log
log stream --predicate 'process == "local-llm-router"' --info
```

### Eval commands

```sh
# Full 125-prompt canonical-suite-v2 against the live daemon
cd ~/Documents/projects/caia/packages/local-llm-router
python3 evals/run_canonical_suite_v2.py \
  --suite evals/canonical-suite-v2.yaml \
  --rules config/routing-rules.yaml \
  --router http://127.0.0.1:7411 \
  --out  ~/Documents/projects/reports/sps_eval_$(date -u +%Y-%m-%d).md

# Look up displacement_pct
grep -E 'DISPLACEMENT_PCT|displacement' ~/Documents/projects/reports/sps_eval_$(date -u +%Y-%m-%d).md
```

### Chain runner / orchestrator

```sh
# Status of the sps-prompting-eval-and-runbook chain
python3 -c "import json; print(json.dumps(json.load(open('$HOME/.caia/chain/sps-prompting-eval-and-runbook/state.json')), indent=2))" | head -40

# Re-arm a stuck phase manually (operator escape hatch)
python3 -c "
import json, datetime
p='$HOME/.caia/chain/<chain-name>/state.json'
s=json.load(open(p))
s['phase_status']['<phase-id>']['status']='pending'
s['phase_status']['<phase-id>']['attempts']=0
s['paused']=False
open(p,'w').write(json.dumps(s,indent=2))"
```

## 4. Common failure modes + fixes

| Failure | Fix shipped | PR / commit | Symptom |
|---|---|---|---|
| **Cold-start timeout** (classifier-model not warm; 30-s urllib timeout fires; classification falls back to abstain → cloud escalation) | **RR-3:** per-model warm tracking + `/admin/warmup` | #488 `66e5a68` | Long classifier elapsed (~30 s) on first prompt; many `unknown`/abstain dispositions. |
| **Intent vocab mismatch** (classifier emits `complex-review` or `unknown` but routing-rules.yaml has no rule, so router defaults to claude) | **RR-2:** close intent-vocab gap; add `complex-review` and `unknown` to rules with sensible tiers | #487 `63826d8` | Heavy cloud escalation on the `code-review` / `prose-rewrite` paths. |
| **Template token leak** (prompt-optimizer's stage-1 prepass emitted `«protected:path:...»` sentinels into the wire prompt) | **R-3:** byte-stable, sanitising prompt template | #476 `5abb0a3` | Local responses with literal `«protected:...»` text; classifier mis-routes due to malformed prompt. |
| **Model-override-bypass** (caller pinning `{ "model": "qwen2.5-coder:7b" }` bypassed router classification → degenerate 64.3 % displacement) | **R-2:** reject caller-supplied concrete model strings; only advisory hints (`auto`, `prefer-*`) accepted | #473 `131abc9` | HTTP 400 `error=model-pinning-not-allowed`. Whitelist via `ROUTER_CLASSIFIER_MODEL` env. |
| **Be-terse compression** (stage-3 optimizer collapsed multi-line prompts into a single line, breaking ground-truth comparisons) | **GC-1:** preserve newlines in compression heuristic | (in sps-router-critical-fixes p3) | Ground-truth A/B scoring zero on previously-passing prompts. |
| **Calls/hr budget** (no rate limit on cloud escalations → cost spike on classifier-cold mornings) | **GB-9:** per-tier calls-per-hour budget + 429 emission | (in sps-prompting-batch-and-budget p1) | HTTP 429 `error=tier-budget-exhausted; tier=cloud-sonnet` on cloud paths after budget exhaustion. |
| **Stale dispatcher fingerprint** (chain dispatcher generated from older template; embedded hash drifts from generator output) | Regenerate via `node packages/chain-runner/bin/generate-run-phase.js <chain>` | b3 #480 | Audit log `dispatch_fingerprint_drift` warnings before each dispatch. |
| **none_eligible streak** (chain stuck — no dispatchable phase because all phases are `blocked`/`failed` with `wait_on_*` reasons) | Orchestrator's `attempt_recovery` re-arms `upstream_block`-classed failures once upstream PRs are merged; operator escape hatch above. | (orchestrator v2) | Audit log fills with `none_eligible` events; `paused=True` with reason `interim-parallel-monitor`. |

## 5. Acceptance criteria

- **`canonical-suite-v2` displacement ≥ 70 %.** This is the contract for
  SPS Tier-3 certification. Below 70 %, the operator should not back-merge
  router changes from `develop` → `main`.
- Per-category displacement should not regress more than 10 pp between
  consecutive eval runs unless a known-upstream change explains it.
- `n_errors` on the smoke suite must be ≤ 5 % of prompts.
- Classifier P50 latency ≤ 3 s with warm models; ≤ 10 s on first call.

## 6. Tuning levers

| Lever | Where | Effect |
|---|---|---|
| `tier-policy thresholds` | `packages/local-llm-router/config/routing-rules.yaml` (`intents[*].default_tier`, `intents[*].confidence_threshold`) | Direct intent → tier mapping. Loosen `local-14b` confidence threshold to bias displacement up; tighten to be conservative. |
| `model-warmup` | `/admin/warmup` (RR-3) | Pre-warm any local model before a heavy session. Idempotent; reports `already_warm` if hot. |
| `ROUTER_CLASSIFIER_MODEL` env | `~/Library/LaunchAgents/com.chiefaia.local-llm-router.plist` (`EnvironmentVariables`) | Pin classifier model server-side. Cannot be overridden by caller (R-2). |
| `cache TTLs` | router LRU on `(prompt_hash, tier)` keys; default 15 min | Increase TTL to amortise cold-start cost on repeated probes; decrease to keep classification adaptive. |
| `calls-per-hour budget` | `routing-rules.yaml` (`tier_budgets[*].calls_per_hour`) | Cap cloud spend (GB-9). Setting `cloud-sonnet: 60` ≈ $X/hr ceiling. |
| `rag.enabled` + `rag.index_path` | router env + `~/.caia/router/file_index.json` | Toggle RAG injection. Disable to bisect quality regressions to RAG vs classifier. |
| `stolution-batch tier wiring` | `routing-rules.yaml` (`intents[*].default_tier: stolution-batch`) + GB-12 wiring | Send batch-mode intents (corpus-distill, embedding-generate) off-host. |

---

**Related artifacts** (under `~/Documents/projects/reports/`):

- `sps_eval_smoke_after_r2_2026-05-15.md` — phase 1 baseline (post-R-2 only).
- `sps_eval_smoke_after_classifier_batch_2026-05-15.md` — phase 2 (post-RR-2/RR-3/R-3).
- `sps_eval_final_canonical_suite_v2_2026-05-15.md` — phase 3 full suite.

**Chain definition:** `~/Documents/projects/agent-memory/sps_prompting_eval_and_runbook_phases.yaml`.

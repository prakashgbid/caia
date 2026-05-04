# DSPy substrate

> Substrate pick #1 of the AI tech modernization proposal §6.
> Greenlit by Prakash 2026-04-30. Owner: orchestrator team.

## What this is

DSPy replaces hand-written prompt strings as the substrate CAIA classifiers
and decomposers compile against. The first program wrapped is the **PO
scope detector**; the proposal §7 feedback loop runs a daily MIPROv2
compile against the last 24 h of production traces and promotes the new
program only if it scores ≥ the previous CURRENT against the 10
PHASE2E-002 prompts.

## Topology

    ┌──────────────────────────────────────────────────────────────────┐
    │ orchestrator (TypeScript)                                         │
    │   detectScope()                                                   │
    │     ├── isDspyRuntimeEnabled()? ──── no ──► legacy callStructured │
    │     └── yes                                                       │
    │           tryDspyScopeDetect()                                    │
    │             └── singleton DspyBridge.predict()                    │
    │                   └── (uv-pinned Python sub-process)              │
    │                         ├── server.py (JSONL RPC)                 │
    │                         ├── lm.py (Ollama HTTP — no API key)      │
    │                         └── programs/po_scope_detector.py        │
    │                               (dspy.ChainOfThought signature)    │
    │                                                                   │
    │     on success → recordTrace() → ~/.caia/dspy/traces/...          │
    │     on failure → fall back to legacy + log                        │
    └──────────────────────────────────────────────────────────────────┘

      cron: dspy-daily-compile.plist (UTC 03:30)
        runDailyCompile()
          ├── buildTrainset(last 24 h)        →  trainset.jsonl
          ├── fixturesToEvalsetRows()         →  evalset.jsonl
          ├── bridge.compile(MIPROv2)         →  po-scope-detector-vN.pkl
          └── delta gate
                ├── delta ≥ 0  →  promote (rewrite CURRENT)
                └── delta < 0  →  rollback (CURRENT untouched)

## On-disk layout

    ~/.caia/dspy/
      compiled/
        po-scope-detector/
          CURRENT                 ← text file: "v3"
          po-scope-detector-v1.pkl
          po-scope-detector-v2.pkl
          po-scope-detector-v3.pkl
          trainset.jsonl          ← last cron's input
          evalset.jsonl           ← PHASE2E-002 (10 rows)
        compiles.log              ← one JSON line per cron run
      traces/
        po-scope-detector/
          2026-04-30.jsonl        ← one row per Predict call
          2026-05-01.jsonl
      runtime/
        po-scope-detector.enabled ← touch this to opt in (or set
                                    CAIA_DSPY_RUNTIME=1)

## Bootstrap

```bash
# 1. install uv (first time only)
curl -LsSf https://astral.sh/uv/install.sh | sh

# 2. materialise the pinned Python env
pnpm --filter @chiefaia/dspy-bridge run py:bootstrap

# 3. sanity-check the LM adapter (Ollama must be running with
#    qwen2.5-coder:7b pulled)
pnpm --filter @chiefaia/dspy-bridge run py:smoke

# 4. opt in for runtime routing
mkdir -p ~/.caia/dspy/runtime && touch ~/.caia/dspy/runtime/po-scope-detector.enabled

# 5. install the daily compile cron
cp infra/cron/dspy-daily-compile.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.chiefaia.dspy-daily-compile.plist
```

## Operating

### Manual compile

```bash
pnpm --filter @chiefaia/dspy-bridge exec tsx scripts/daily-compile.ts
# → [dspy:po-scope-detector] promoted v4 (prev=0.74 next=0.78 Δ=+0.040 train=23)
```

### Inspect history

```bash
tail -f ~/.caia/dspy/compiled/compiles.log | jq .
```

### Roll back to a known good version

```bash
echo v2 > ~/.caia/dspy/compiled/po-scope-detector/CURRENT
```

The orchestrator picks up the new pointer on the next call — no
restart needed.

### Disable the substrate (kill switch)

```bash
rm ~/.caia/dspy/runtime/po-scope-detector.enabled
# or unset CAIA_DSPY_RUNTIME on the orchestrator service
```

`detectScope()` falls back to the legacy `callStructured()` path
immediately. The compile cron keeps running so when you re-enable, the
CURRENT pointer is still warm.

## Hard constraints (Prakash 2026-04-30)

- **No API key.** `lm.py` calls Ollama HTTP only. The TypeScript
  bridge scrubs `ANTHROPIC_API_KEY` from the spawned env. Claude
  binary subscription remains the only sanctioned Claude path —
  hooked in upstream by `@chiefaia/local-llm-router`.
- **Local-first AI.** Default model `qwen2.5-coder:7b` via Ollama.
- **No system pollution.** Python deps live under
  `packages/dspy-bridge/python/.venv/`, managed by `uv`. Never
  `pip install` into system Python.
- **No daemon restart.** Cron is a separate LaunchAgent; the
  orchestrator picks up the CURRENT pointer on the next call.

## Substrate evolution

- **Now:** MIPROv2 compile against PHASE2E-002 fixtures.
- **Q3:** swap the JSONL trace store for a Langfuse exporter (proposal
  §7 next phase). Same downstream JSONL shape — just a different
  reader. The fallback JSONL stays for disaster recovery.
- **Q4:** consider GEPA (Genetic Eval-driven Prompt Architect) as the
  optimizer. The `optimizer` field on `CompileParams` already pins
  `'miprov2'` as a literal type so the upgrade path is one PR away.

## Deps

| Package           | Version              | Why                                      |
|-------------------|----------------------|------------------------------------------|
| `dspy-ai`         | `>=2.5.40,<3`        | the substrate                            |
| `pydantic`        | `>=2.7,<3`           | DSPy's signature engine                  |
| `httpx`           | `>=0.27,<1`          | Ollama HTTP client (no openai/anthropic) |

Adding a Python dep requires a §Deps update in this file + PR review.
The whole point of `uv` isolation is to keep the dependency surface
narrow and auditable.

## See also

- [`packages/dspy-bridge/`](../../packages/dspy-bridge/) — the package
- [`infra/cron/dspy-daily-compile.plist`](../../infra/cron/dspy-daily-compile.plist) — cron spec
- [`packages/decomposer-recursive/src/dspy-runtime.ts`](../../packages/decomposer-recursive/src/dspy-runtime.ts) — the runtime router
- [`packages/decomposer-recursive/tests/diverse-prompts-validation.test.ts`](../../packages/decomposer-recursive/tests/diverse-prompts-validation.test.ts) — PHASE2E-002 fixtures (source of truth)
- AI tech modernization proposal §6 (substrate pick), §7 (feedback loop)

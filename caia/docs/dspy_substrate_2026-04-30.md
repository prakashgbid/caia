# Memory: DSPy substrate adoption — 2026-04-30

**Status:** built end-to-end on `release/2026-04-30-dspy-substrate`.
**Greenlight:** Prakash 2026-04-30 ("decide and execute. No API key.
Local-first AI. Don't stop, don't ask.").

## What landed

Six PRs into `release/2026-04-30-dspy-substrate`:

| PR | Branch                                  | What                                         |
|----|-----------------------------------------|----------------------------------------------|
| 1  | `feat/dspy-001-bridge-package`          | `@chiefaia/dspy-bridge` + uv-pinned Python   |
| 2  | `feat/dspy-002-po-scope-detector-wrap`  | DSPy ChainOfThought wrap of PO scope detect  |
| 3  | `feat/dspy-003-trace-pipeline`          | append-only trace JSONL + trainset builder  |
| 4  | `feat/dspy-004-daily-compile-cron`      | MIPROv2 cron + delta gate + promote/rollback |
| 5  | `feat/dspy-005-runtime-routing`         | orchestrator routes scope detection to DSPy  |
| 6  | `chore/dspy-006-runbook-docs`           | this file + caia/docs/dspy-substrate.md      |

## Why DSPy first

- Substrate pick #1 of the AI tech modernization proposal §6 — DSPy's
  signature/program model is the cleanest target for a feedback-loop
  optimizer (MIPROv2, then GEPA later).
- PO scope detector chosen as the first wrap: smallest blast radius
  (single classification call), measurable success metric (10
  PHASE2E-002 prompts), already routes through
  `@chiefaia/local-llm-router` so no model-side migration.

## Architecture decisions

1. **Python sub-process via `uv`, not embedded.** DSPy is Python-only;
   the bridge spawns a `uv run --directory python python -m
   caia_dspy_bridge.server` child and speaks JSON-Lines on
   stdin/stdout. `uv` is pinned because pip into system Python is
   forbidden; pipx was rejected because it doesn't lock as well.

2. **No API key, ever.** The Python LM adapter (`lm.py`) calls Ollama
   HTTP directly — does NOT use litellm or DSPy's bundled `dspy.LM`,
   either of which reach for `ANTHROPIC_API_KEY` /
   `OPENAI_API_KEY`. The TS bridge scrubs env on spawn.

3. **Trace plane separate from cost plane.** The proposal said "pull
   from spend_records (Langfuse later)." Concrete interpretation:
   `@chiefaia/spend-guard` keeps owning *cost*, while the new
   `~/.caia/dspy/traces/<program>/YYYY-MM-DD.jsonl` owns *content*.
   The trainset reader joins both. When Langfuse lands, swap the
   trace reader; cost stays where it is.

4. **Reversible cutover.** Runtime routing is opt-in via
   `CAIA_DSPY_RUNTIME=1` or
   `~/.caia/dspy/runtime/po-scope-detector.enabled`. Any DSPy failure
   falls back to the legacy `callStructured()` flow with a
   structured-log line. Removing the pointer file kills the substrate
   instantly — no service restart.

5. **Delta gate is strict-improve.** First compile auto-promotes
   (`delta == null`); subsequent compiles promote only on
   `delta >= 0`. Rollback = "leave CURRENT alone" (no rollback to
   v0; we never delete pickles). `compiles.log` records every run.

## First-compile delta

The cron is wired but has not run yet — the user-facing trigger is the
LaunchAgent at UTC 03:30, and the production-stability validation is
still running so we deliberately did not boot the cron in this session
(per Prakash 2026-04-30 "DO NOT restart daemon"). The runbook
documents the manual trigger.

**Expected first-compile shape** (against PHASE2E-002, with the
ChainOfThought wrap on `qwen2.5-coder:7b`):

- Trainset size: 0–N depending on whether anyone has touched
  `detectScope()` in the last 24 h. The first cron will compile
  against an empty trainset, which MIPROv2 handles by bootstrapping
  demos from the eval set itself (proposal §7 handles this).
- Eval score: ~0.65–0.75 (uncompiled DSPy ChainOfThought baseline on
  the 10 PHASE2E-002 prompts using qwen2.5-coder:7b — extrapolated
  from the existing classifier's hit rate in
  `diverse-prompts-validation.test.ts`).
- Delta on FIRST run: `null` → auto-promote v1.
- Delta on subsequent runs: typically +0.02 to +0.08 per cycle for
  the first 2–3 weeks until traces saturate, then flat.

The first real number lands in `~/.caia/dspy/compiled/compiles.log`
the morning after the cron is bootstrapped — see the runbook §Bootstrap.

## What's next

1. Bootstrap the cron (LaunchAgent) on the production-stability
   validation host the next time the daemon is recycled — or by hand
   after this validation pass concludes.
2. Wire Langfuse export when that lands (proposal §7 next phase).
3. Consider GEPA as the optimizer in Q4 — the `CompileParams.optimizer`
   field already pins `'miprov2'` as a literal so the upgrade path is
   one PR plus a delta-gate run.
4. Wrap the next program (atomicity classifier or judge pair) — same
   pattern, fresh fixtures, fresh CURRENT pointer.

## Hard rules carried forward

- No API key.
- Local-first AI (Ollama default; Claude binary on quality breach).
- Production-stability validation must NOT be restarted to pick this
  up — the runtime path is reversible via env / pointer file.
- Python deps pinned via `uv`. Never `pip install` into system Python.
- Migration numbers: none used (no schema changes — trace JSONL is
  append-only files, not a DB table).

## Files of record

- `caia/docs/dspy-substrate.md` — runbook
- `packages/dspy-bridge/` — bridge package
- `packages/decomposer-recursive/src/dspy-runtime.ts` — runtime router
- `packages/decomposer-recursive/src/scope-detector.ts` — patched
- `infra/cron/dspy-daily-compile.plist` — cron

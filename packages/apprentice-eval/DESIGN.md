# `@chiefaia/apprentice-eval` — Phase 1 Design

**Status**: Phase 1 of the Apprentice Agent (per `agent/memory/apprentice_agent_directive.md`). Sibling to Phase 0 (`@chiefaia/apprentice-corpus`), Phase 2 (training), Phase 3 (serving), Phase 4 (retrainer).
**Shape**: Option E — CAIA-Bonded Skeleton (per `agent_architecture_shape_2026-05-06.md`).
**Author**: Apprentice Phase 1 leg 1 (2026-05-06). Stages 1-3 deliverable; Stages 4-10 land in leg 2.
**Scope**: eval harness only. Loading adapters in production (serving) and triggering training are sibling packages, NOT this one.

## 1. Mandate

Score the Apprentice base model + each candidate LoRA adapter against a canonical prompt suite. Produce a deterministic, reviewable win-rate report so the operator (and Phase 4's retraining cron) can decide whether a new adapter is good enough to promote to canary / production. Never silently swap in an adapter.

The harness has three personas:

1. **Pre-promotion gate**: a candidate adapter built by Phase 2 training is automatically scored before any rollout. If `winRate < threshold`, it does not even reach shadow mode.
2. **Continuous regression monitor**: the same canonical suite re-runs on every retraining cycle, so we can catch catastrophic forgetting (newer adapter loses on prompts that older versions handled).
3. **Operator-facing A/B harness**: the operator can blind-evaluate ambiguous outputs (where rubric scoring tied or split) and contribute their preference back as ground truth.

Phase 0 (corpus) → ship: instruction-output pairs + manifest with config hash.
Phase 1 (eval, this package) → ship: per-adapter score-card + win-rate report against base.
Phase 2 (training) → ship: a `.safetensors` adapter + training log.
Phase 3 (serving) → ship: Ollama adapter loading + canary wiring.
Phase 4 (retrainer) → ship: weekly cron that re-runs Phases 0 → 1 → 2 → optional 3.

## 2. Package shape (Option E checklist)

- ✅ `packages/apprentice-eval/` (NOT `apps/apprentice/eval-harness/` — apps consume packages).
- ✅ `package.json`: `"private": true`, scope `@chiefaia/apprentice-eval`, never published.
- ✅ Public API parameterised via `ApprenticeEvalConfig` constructor — every CAIA path / Ollama URL / adapter registry / corpus directory is a parameter with a CAIA default.
- ✅ Tests inject fixture suites (`tests/__fixtures__/mini-suite/*.yaml`) + a fake `OllamaClient` + a fake `RubricScorer` — never live Ollama / live corpus paths.
- ✅ Pre-spawn injection: when this harness invokes the `claude` binary as a judge for ambiguous outputs (rare path, behind `judgeEnabled`), the prompt passes through `caia-mentor-prepend | caia-librarian-prepend` (existing CAIA convention) — orchestrator wires; package itself doesn't bypass.
- ✅ AGENTS.md (already filed at repo root) is consulted for build / test / lint / typecheck commands.

## 3. Public API

```typescript
import { ApprenticeEvalHarness } from '@chiefaia/apprentice-eval';

const harness = new ApprenticeEvalHarness({
  // All optional — CAIA defaults filled in by constructor.
  corpusManifestPath: '~/Documents/projects/apprentice/corpora/2026-05-06/manifest.json',
  suiteRoot: 'packages/apprentice-eval/suites',
  baselineRoot: 'packages/apprentice-eval/baselines',
  outputRoot: '~/Documents/projects/apprentice/eval-runs',
  baseModel: 'qwen2.5-coder:7b',                    // Ollama tag
  adapters: [
    { name: 'apprentice-2026-05-06', kind: 'qwen2.5-coder:7b', path: '~/Documents/projects/apprentice/adapters/2026-05-06-rank16/' },
  ],
  ollamaBaseUrl: 'http://127.0.0.1:11434',          // local-llm-router default
  judgeEnabled: false,                               // optional claude-binary judge for tied outputs
  judgeBudget: 50,                                   // hard cap on subscription-bucket consumption per run
  abMode: false,                                     // operator-blind A/B evaluation flag
  // Behaviour knobs:
  winRateThreshold: 0.6,                             // promote-to-canary threshold
  forgettingThreshold: 0.1,                          // any baseline regression > 10% on a prior-passing prompt is a hard fail
  warmupRuns: 2,                                     // Ollama keep-alive warmup
  perPromptTimeoutMs: 90_000,
  // Dependency injection (test seams):
  ollama: defaultOllamaClient,
  rubricScorer: defaultRubricScorer,
  judge: defaultClaudeJudge,
  fs: defaultFsReader,
  clock: () => new Date(),
});

const report = await harness.evaluate();
// report.outputDir is `<outputRoot>/<YYYY-MM-DD-HHmm>/`
// report.adapters[i].winRateVsBase is the headline number
// report.regressionFlags lists any forgetting violations
```

CLI:

```bash
# Run every suite, score base + each adapter
caia-apprentice-eval run

# Subset (one suite, one adapter)
caia-apprentice-eval run --only directive,feedback --adapter apprentice-2026-05-06

# Plan only (no Ollama calls)
caia-apprentice-eval run --dry-run

# Refresh baseline scores (after operator blesses a new floor)
caia-apprentice-eval baseline --update

# Operator-blind A/B (interactive)
caia-apprentice-eval ab --suite directive --pairs 20

# Help
caia-apprentice-eval --help
```

## 4. Pipeline / data flow

```
            ┌────────────────────────────────────────────────────────┐
            │  PromptSuite                                            │
            │  (50-200 canonical prompts in YAML)                     │
            └────────────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌────────────────────┐
                     │  for each adapter  │
                     │  in [base, ...A]   │
                     └────────────────────┘
                              │
                              ▼
        ┌──────────────────────────────────────────────────────────┐
        │  OllamaClient.generate(prompt, model, adapter?)          │
        │   — base run: model alone                                 │
        │   — candidate run: model + adapter loaded via /api/generate
        │   — with warmup + per-prompt timeout                     │
        └──────────────────────────────────────────────────────────┘
                              │
                              ▼
       ┌───────────────────────────────────────────────────────────┐
       │  RubricScorer.score(prompt, output, rubric)               │
       │   — assertions: contains, regex, javascript, semanticDiff │
       │   — structural-shape match (Markdown headers, code-fence) │
       │   — operator-voice continuation score                     │
       │   — must-include / must-not-include hits                  │
       └───────────────────────────────────────────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────────────────────┐
        │  PairwiseAggregator                                      │
        │   — winner per prompt: base | A | tie                    │
        │   — winRate(A) := wins / (wins + losses)                 │
        │   — regression flag: A loses on a prompt where baseline  │
        │     PASSED ≥ N runs back                                 │
        └─────────────────────────────────────────────────────────┘
                              │
                              ▼
                     ┌────────────────────┐
                     │  optional Judge    │
                     │  (claude binary)   │
                     │  for ties only     │
                     └────────────────────┘
                              │
                              ▼
        ┌─────────────────────────────────────────────────────────┐
        │  Report writer                                           │
        │   — score-cards.json (per-adapter, per-suite)            │
        │   — winrate-report.json (pairwise + regression flags)    │
        │   — outputs/<adapter>/<suite>/<prompt-id>.json (full I/O)│
        │   — summary.md (operator-readable; one screen)           │
        └─────────────────────────────────────────────────────────┘
```

The harness is **idempotent + deterministic**: same suite + same adapter + same `seed` → byte-identical `score-cards.json`. The headline `winRate` is a stable number we can plot over time.

## 5. Where the prompt suite comes from

A canonical 50-200 prompt suite spanning all of CAIA's behavioural surface. Three sources:

### 5a. Hand-curated CAIA-vocabulary prompts (50-100 prompts)

Operator's idiom + the project's vocabulary. Examples:

- "Decompose into Initiative → Epic → Story → Task: build a self-perpetuating campaign loop with a 20-leg sanity cap."
- "What does `feedback_no_api_key_billing.md` say to do or avoid, and why?"
- "Summarise the standing rule in this directive: <body of `feedback_decision_classifier.md`>."
- "Write a 2-paragraph pre-mortem for: shipping a LoRA adapter without a rollback target."
- "Given the failure: gitleaks flagged a literal credential in a test fixture, then a follow-up commit fixed the source but the gate still failed. What's the standing-rule fix?"

These exercise the project-bonded vocabulary and the institutional memory the operator considers "the project's voice." Stored as YAML eval suites under `suites/`.

### 5b. Sampled-from-corpus held-out prompts (auto-generated, ~50)

When `apprentice-corpus` produces `samples.jsonl`, a random hold-out fraction (configurable, default 5%) is excluded from training. The eval harness imports those held-out prompts as "test set" — the model has never seen them, so this is a pure generalisation probe.

The corpus's `manifest.json` records the held-out prompt ids in `holdout: string[]` so it's reproducible. (Phase 0 needs a small change to honour this — captured in §11 risk #6.)

### 5c. Mentor-incident-derived prompts (when Mentor's events.sqlite has data, ~20)

Each captured incident with classification + lesson becomes a prompt:

- Q: full description of the failure shape.
- A-rubric: must-include the lesson's core directive verb (e.g. "squash"); must-not-include the failure pattern (e.g. don't suggest force-push).

This catches "did the adapter actually internalise the lessons, or just memorise their surface phrasing?"

### Suite YAML format

We piggyback on `@chiefaia/prompt-evals`'s YAML primitives (Promptfoo-compatible, already in CAIA), but with a different provider stack:

```yaml
description: 'apprentice-eval suite — directive-summarisation'

defaultTest:
  vars:
    agent: apprentice
  assert:
    - type: javascript
      value: 'output.length > 80 && output.length < 4000'
    - type: contains
      value: 'standing rule'

tests:
  - description: 'directive — apprentice should summarise the standing rule clearly'
    vars:
      prompt: |
        Summarise the standing rule or directive in this document.
        ---
        # Squash secret-introducing commits …
        <body of feedback_secret_scanner_history_squash.md>
    assert:
      - type: contains
        value: 'squash'
      - type: regex
        value: 'reset --soft|fresh commit'
      - type: not-contains
        value: 'force-push'   # the rule explicitly forbids this
```

The `provider` is selected at run-time per adapter — see §6. Assertion types we exercise:

| Assertion type | What it scores |
|---|---|
| `contains` / `not-contains` | Token-level must-include / must-not-include |
| `regex` | Pattern matches over the output |
| `javascript` | Sandboxed JS predicate over `output` (e.g. shape, length) |
| `equals` | Exact match (rare; mostly for snapshot tests) |
| `semantic-similarity` | Embedding cosine via `nomic-embed-text` (Ollama, local) — for paraphrase tolerance |

Assertion weights are uniform unless `weight: <0..1>` is set on the assertion.

## 6. Adapter loading via Ollama

CAIA's standard local inference path is Ollama, wrapped by `@chiefaia/local-llm-router`. The eval harness uses Ollama directly (skipping the router's task-type routing) so we control the model + adapter choice exactly:

```typescript
// Base model only
POST /api/generate
{ "model": "qwen2.5-coder:7b", "prompt": "...", "stream": false, "options": { "seed": 42 } }

// Model + adapter
POST /api/generate
{
  "model": "qwen2.5-coder:7b",
  "adapter": "/Users/MAC/Documents/projects/apprentice/adapters/2026-05-06-rank16/adapter.safetensors",
  "prompt": "...",
  "stream": false,
  "options": { "seed": 42 }
}
```

Ollama 0.4+ supports adapter loading via the `adapter` field. If the operator's installed Ollama version doesn't support adapter loading, the harness falls back to invoking `mlx_lm.generate --model <base> --adapter-path <adapter>` as a subprocess (Mac-native, slower, but guaranteed to work). Detection happens at `harness.evaluate()` start.

Concurrency: capped at 1 (Ollama loads adapters sequentially; running parallel adapter loads thrashes RAM on a 16GB Mac per the Apprentice directive's hardware-reality call-out).

Warmup: each adapter gets `warmupRuns` (default 2) throwaway prompts before scoring begins, so the first scored prompt isn't penalised for cold-start latency / weight-loading variance.

## 7. Comparison + scoring

Two scoring modes, both computed on every run:

### 7a. Per-prompt rubric pass/fail

For each (prompt, adapter) pair we get a list of assertion results. The `prompt-evals` Promptfoo-shape library already does this; we adopt its summary structure:

```json
{
  "promptId": "directive-secret-scanner-squash",
  "adapter": "apprentice-2026-05-06",
  "passed": 3,
  "failed": 1,
  "weightedScore": 0.75,
  "assertions": [...]
}
```

Per-suite pass-rate is the headline `prompt-evals`-style metric, comparable to the existing CAIA agent suites.

### 7b. Pairwise win-rate vs base

For every prompt:

```
result(adapter, prompt) = "win"  if weightedScore(adapter) > weightedScore(base) + epsilon
                          "loss" if weightedScore(adapter) < weightedScore(base) - epsilon
                          "tie"  otherwise (epsilon default 0.05)

winRate(adapter) := wins / (wins + losses)        # ties excluded from denominator
                  = wins / (wins + losses)         # in [0, 1]; 0.5 = parity
```

Promote-to-canary threshold: `winRateThreshold` (default 0.6).
Promote-to-production: operator blesses + canary holds for 3 days (Phase 3 logic; eval just gates eligibility).

### 7c. Regression detection (forgetting prevention)

The harness writes a `baselines/<adapter-or-base>.json` file each run, snapshotting per-prompt pass/fail. On the next run we compare:

- If a prompt that previously **passed** for the base or for an older blessed adapter now **fails** for the candidate, AND the score delta exceeds `forgettingThreshold` (default 0.1), it's flagged in `regressionFlags`. ANY regression flag automatically disqualifies the adapter from canary regardless of `winRate`.

The eval suite intentionally retains older prompts forever — Apprentice directive §11 failure mode #1 (catastrophic forgetting). The harness operationalises that by treating the historical pass-set as a contract.

### 7d. Optional `claude`-binary judge for ties

When two adapters tie on the rubric (or the rubric can't capture qualitative differences like "operator-voice"), the harness can route the (prompt, output_A, output_B) tuple through a `claude --print` subprocess for a binary preference judgment. This is bounded:

- `judgeEnabled: false` by default — the rubric is the source of truth.
- `judgeBudget: 50` per run. Hard cap. The harness logs how many it actually fired and why.
- Subscription-only — `ANTHROPIC_API_KEY` is explicitly cleared from the spawned env (same pattern as `apprentice-corpus`'s distiller).
- Judge results land in `judge.jsonl` for audit. Operator can override.

This mirrors what large eval frameworks call "LLM-as-judge", but bounded + auditable + opt-in.

## 8. Win-rate report

The operator-facing summary is `summary.md` — one screen, scannable:

```markdown
# Apprentice eval run — 2026-05-13 14:32

Base: `qwen2.5-coder:7b`
Adapters scored: `apprentice-2026-05-13-rank16`, `apprentice-2026-05-13-rank32`

| Adapter | Suite pass-rate | Win-rate vs base | Regressions | Decision |
|---|---|---|---|---|
| (base) | 0.71 | — | — | (baseline) |
| apprentice-2026-05-13-rank16 | 0.78 | 0.62 | 0 | ✅ promote to canary |
| apprentice-2026-05-13-rank32 | 0.74 | 0.55 | 2 | ❌ regressions detected — see flags |

## Top wins (apprentice-2026-05-13-rank16 over base)
- `directive-secret-scanner-squash` — base 0.50 → adapter 1.00
- `feedback-no-api-key-billing` — base 0.62 → adapter 1.00
- ...

## Top losses (apprentice-2026-05-13-rank32 vs base)
- `report-summarise-quincy` — base 0.85 → adapter 0.40 ❌ flagged

## Per-suite breakdown
[table per suite × per adapter]
```

The full machine-readable artifacts are in the same output directory:

- `score-cards.json` — per-adapter per-suite per-prompt
- `winrate-report.json` — pairwise + regression flags
- `outputs/<adapter>/<suite>/<prompt-id>.json` — every I/O pair (audit trail)
- `judge.jsonl` — judge transcript (if invoked)
- `config.json` — sanitised config snapshot (incl. corpus manifest hash)

## 9. Operator-blind A/B mode

`caia-apprentice-eval ab --suite directive --pairs 20` runs an interactive harness:

1. Sample 20 prompts from the suite.
2. For each prompt, generate output from base and from one chosen adapter.
3. Display the prompt + both outputs, randomly ordered, anonymised as "A" and "B".
4. Operator picks A / B / tie / skip via single-key input.
5. Write preference to `ab-preferences.jsonl` with the un-anonymised mapping.

The operator's preference is then folded back into the next training corpus snapshot as DPO-style (or similar) preference data — a Phase 2-side use case, but the file format is fixed here.

A/B mode is opt-in; never auto-fires. Fully cancellable mid-run.

## 10. Output layout

```
<outputRoot>/<YYYY-MM-DD-HHmm>/
├── summary.md                              ← operator-facing one-pager
├── score-cards.json                        ← per-adapter per-suite per-prompt assertions
├── winrate-report.json                     ← pairwise + regression flags
├── config.json                             ← sanitised config + corpus manifest hash
├── judge.jsonl                             ← (optional) claude-judge transcript
├── ab-preferences.jsonl                    ← (optional) A/B mode preferences
└── outputs/
    ├── base/
    │   └── <suite-id>/
    │       └── <prompt-id>.json            ← full I/O for the base run
    └── <adapter-name>/
        └── <suite-id>/
            └── <prompt-id>.json            ← full I/O for the adapter run
```

A new run never overwrites a prior run's directory. The `baselines/` directory tracks the rolling-best per (adapter-class, suite-prompt) tuple — refreshed only via `baseline --update` (operator-explicit).

## 11. Risks + failure modes

| Risk | Mitigation |
|---|---|
| **R1**: Rubrics over-fit operator phrasing → adapter that matches operator wins regardless of substantive accuracy | Hand-curated suite has prompts where the right answer **disagrees** with operator's first instinct (Apprentice directive §11 failure mode #2). |
| **R2**: Held-out prompt sampling not deterministic → reruns aren't comparable | Held-out ids fixed in `manifest.json`; harness reads them, never re-samples. Phase 0 needs a small change — see risk #6. |
| **R3**: Ollama doesn't support adapters in operator's version | Detect at start; fall back to `mlx_lm.generate` subprocess. Document in README. |
| **R4**: Concurrency thrashes RAM on 16GB Mac | Concurrency hard-capped at 1; warmup runs between adapter swaps. |
| **R5**: Judge calls saturate operator's subscription bucket | `judgeBudget` hard cap; default `judgeEnabled: false`; explicit `ANTHROPIC_API_KEY` clear. |
| **R6**: `apprentice-corpus`'s `manifest.json` doesn't yet have `holdout: string[]` | Phase 0 update: add deterministic holdout sampling (seeded by `corpusManifestPath` mtime + `holdoutSeed` config). Track as a small follow-up PR; lands before Phase 1 leg 2 ships. |
| **R7**: Adapter passes rubric but produces verbose / off-tone output | Rubric includes structural shape + length bands + operator-voice continuation tests. Tied outputs route to optional judge. |
| **R8**: Eval flakes due to model nondeterminism | `seed` pinned per prompt; `temperature: 0.0` for scored runs. A/B mode allows higher temperature, recorded in output. |
| **R9**: Forgetting threshold too tight → blocks every adapter | `forgettingThreshold` is configurable; baselines explicitly snapshotted per blessed adapter (not just the static base) so the threshold is relative to whichever adapter is currently in production. |
| **R10**: Suite drifts faster than corpus → adapter fails on prompts no one trained on | Suite changes are PR-gated through Evidence Gate; new suite items must include a baseline run before merging. |

## 12. Hard constraints (Apprentice directive non-negotiables this package respects)

- 🚨 **Subscription-only LLM cost**. Distillation / judge calls go through `claude` binary subprocess against the operator's session, never an API key. `ANTHROPIC_API_KEY` is explicitly cleared from the spawned env.
- 🚨 **No paid GPU**. Inference is local Ollama on Mac M-series. MLX-LM subprocess fallback is also Mac-native.
- 🚨 **No noise**. Operator-facing output is `summary.md` — capped at one screen. Full machine-readable artifacts live in `outputs/`.
- 🚨 **Decision-classifier**: harness **decides**: per-prompt pass/fail, win-rate, regression flags, candidate eligibility for canary. **Asks operator only** via `ab` mode (opt-in) or via the `--update` baseline flag (explicit operator-blessing). Never auto-promotes to production.
- 🚨 **No silent model swaps**. Eval is a gate, not a dispatcher. Phase 3 (serving) consumes the eval verdict; never mixes responsibilities with scoring.

## 13. Package layout (for Stages 4-10, next leg)

```
packages/apprentice-eval/
├── DESIGN.md                   ← this file
├── README.md                   ← Stage 10
├── package.json                ← private @chiefaia/apprentice-eval
├── tsconfig.json + tsconfig.build.json
├── eslint.config.cjs
├── vitest.config.ts
├── suites/                     ← canonical YAML eval suites (~50-200 prompts)
│   ├── directive.yaml
│   ├── feedback.yaml
│   ├── report.yaml
│   ├── pre-mortem.yaml
│   ├── decomposition.yaml
│   └── ...
├── baselines/                  ← per-adapter pass-rate snapshots (committed)
│   ├── base.json
│   └── <blessed-adapter-name>.json
├── src/
│   ├── types.ts                ← PromptSuite, RubricResult, ScoreCard, WinrateReport, …
│   ├── config.ts               ← ApprenticeEvalConfig + resolveConfig() with CAIA defaults
│   ├── suite-loader.ts         ← reads YAML suites from suiteRoot
│   ├── corpus-bridge.ts        ← reads holdout ids from corpus manifest
│   ├── ollama-client.ts        ← /api/generate adapter-aware client
│   ├── mlx-fallback.ts         ← mlx_lm subprocess fallback
│   ├── rubric-scorer.ts        ← Promptfoo-shape assertion runner
│   ├── pairwise.ts             ← win-rate aggregator + regression detector
│   ├── judge.ts                ← claude-binary subprocess (judgeEnabled gate)
│   ├── ab-mode.ts              ← interactive A/B harness
│   ├── report-writer.ts        ← summary.md + score-cards.json + winrate-report.json
│   ├── baseline-store.ts       ← read / write baselines/ snapshots
│   ├── harness.ts              ← top-level ApprenticeEvalHarness orchestration
│   ├── cli.ts                  ← caia-apprentice-eval entry point
│   └── index.ts                ← public API barrel
├── tests/
│   ├── __fixtures__/
│   │   ├── mini-suite/
│   │   │   ├── directive.yaml
│   │   │   └── feedback.yaml
│   │   └── mini-corpus/
│   │       └── manifest.json
│   ├── helpers/
│   │   └── fakes.ts            ← fake OllamaClient / RubricScorer / Judge
│   └── *.test.ts               ← per-module unit tests + an integration test
└── plists/                     ← (Phase 4 sibling will add a retrainer-cron plist; eval itself runs on demand from the retrainer's flow, not on its own schedule)
```

No `plists/` yet — eval is invoked on demand by the retrainer (Phase 4) or by the operator's CLI; doesn't need its own LaunchAgent. (Cf. Phase 0 which DOES need a daily aggregator cron.)

## 14. What this package depends on

Workspace deps:

- `@chiefaia/apprentice-corpus` (workspace:*) — for the `manifest.json` shape; we read but don't write.
- `@chiefaia/local-llm-router` (workspace:*, optional) — only the type definitions for `OllamaResponse`-shape; we do NOT route through it for eval (deterministic provider invocation only).
- `@chiefaia/prompt-evals` (workspace:*, optional) — we mirror the YAML schema + assertion-runner shape; can later optionally call into its scorer.

External deps:

- `js-yaml` — suite parsing.
- `vitest` — tests.
- (No Promptfoo runtime dep — we replicate the scoring primitives we need; keeps the package light + transitively-licence-clean per AGENTS.md.)

## 15. Stages 4-10 outline (next leg)

Stage 4 (Implement):
- Build `harness.ts` orchestration glue.
- Build all `*.client.ts` / `*-scorer.ts` modules.
- Wire `cli.ts`.
- 5-8 hand-curated suites covering ~50 prompts (Phase 0 corpus has ~250 sources; 50 prompts is enough for v0).

Stage 5 (Unit test):
- Per-module fakes; ~80-100 tests.
- Suite-loader + rubric-scorer get the most coverage (rubric correctness is the eval's correctness).

Stage 6 (Integration test):
- 1 end-to-end test exercising the full pipeline against a fake `OllamaClient` returning canned outputs. Verifies summary.md / score-cards.json / winrate-report.json shapes.

Stage 7 (Deploy):
- No LaunchAgent. Phase 4 (retrainer) calls `harness.evaluate()` programmatically.
- Document in README how to invoke from the CLI.

Stage 8 (E2E live verify):
- Run against real CAIA `apprentice-corpus` manifest + base Ollama model + (if available) a stub adapter.
- If Ollama isn't running locally, document the gap and skip — don't block.

Stage 9 (Regression):
- Apply the leg-3 standing rule: `pnpm --filter @chiefaia/apprentice-eval -r build` then `pnpm -r typecheck` + `pnpm -r lint`. NOT `pnpm -r build`.
- Package: vitest + lint + typecheck + build.

Stage 10 (Document):
- README + this DESIGN.md final pass.
- Completion doc + structural-lesson-if-any.

## See also

- `agent/memory/apprentice_agent_directive.md` — full Apprentice campaign spec (this is its Phase 1).
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule.
- `agent/memory/feedback_monorepo_regression_gate_ergonomics.md` — leg-3 standing rule that constrains Stage 9.
- `agent/memory/feedback_secret_scanner_history_squash.md` — leg-2 standing rule that the rubric must encode (Mentor-derived prompt §5c example).
- `packages/apprentice-corpus/DESIGN.md` — sibling package; manifest.json shape is the input contract.
- `packages/prompt-evals/README.md` — YAML eval-suite primitives we reuse.
- `packages/local-llm-router/README.md` — Ollama client shape we mirror.
- `~/Documents/projects/reports/apprentice-phase-0-stage-10-complete-2026-05-06.md` — leg-3 completion + handoff hooks.

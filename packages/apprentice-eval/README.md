# `@chiefaia/apprentice-eval`

Phase 1 of the Apprentice Agent. Scores the Apprentice base model + each candidate LoRA adapter against a canonical prompt suite (hand-curated CAIA-vocabulary prompts + corpus-holdout + Mentor-incident-derived). Emits a deterministic per-prompt score-card, pairwise win-rate vs base, and a regression-flag set that disqualifies adapters from canary if they regress on prompts the base previously passed.

Sibling packages: [`@chiefaia/apprentice-corpus`](../apprentice-corpus/) (Phase 0, the input contract), Phase 2 training (planned), Phase 3 serving (planned), Phase 4 retrainer cron (planned).

Full design: [`DESIGN.md`](./DESIGN.md).

## Shape (Option E)

- `private: true`, scope `@chiefaia/apprentice-eval` — never published.
- Public API parameterised via `ApprenticeEvalConfig` constructor; every CAIA path / Ollama URL / adapter registry is a parameter with a CAIA default.
- Tests inject fixture suites + a fake `OllamaClient` + a fake `ClaudeJudge` — never live CAIA paths.
- Per `agent_architecture_shape_2026-05-06.md`.

## Install / build

```bash
pnpm install
pnpm --filter @chiefaia/apprentice-eval build
```

## Usage

### Programmatic

```ts
import { ApprenticeEvalHarness, createOllamaClient } from '@chiefaia/apprentice-eval';

const harness = new ApprenticeEvalHarness({
  baseModel: 'qwen2.5-coder:7b',
  adapters: [
    { name: 'apprentice-2026-05-13-rank16', kind: 'qwen2.5-coder:7b', path: '/path/to/adapter.safetensors' }
  ],
  ollama: createOllamaClient({ baseUrl: 'http://127.0.0.1:11434' })
});

const report = await harness.evaluate();
console.log(report.outputDir);
for (const a of report.adapters) {
  console.log(`${a.adapter}: winRate=${a.winrate.winRate.toFixed(2)} → ${a.winrate.decision}`);
}
```

### CLI

```bash
# Run every suite, score base + each configured adapter
caia-apprentice-eval run

# Restrict to one suite + one adapter
caia-apprentice-eval run --only directive --adapter apprentice-2026-05-13-rank16

# Plan only — no Ollama calls
caia-apprentice-eval run --dry-run

# Refresh baselines (operator-explicit)
caia-apprentice-eval baseline --update

# Operator-blind A/B preference capture
caia-apprentice-eval ab --only directive --adapter apprentice-2026-05-13-rank16 --pairs 20

# Help
caia-apprentice-eval --help
```

## Output layout

Each run lands in `<outputRoot>/<YYYY-MM-DD-HHmm>/`:

```
summary.md                              ← one-screen operator-readable verdict
score-cards.json                        ← per-adapter per-suite per-prompt rubric results
winrate-report.json                     ← pairwise outcomes + regression flags
config.json                             ← sanitised config snapshot
judge.jsonl                             ← (optional) claude-judge transcript
ab-preferences.jsonl                    ← (optional) A/B mode preferences
outputs/
  base/<suite>/<prompt-id>.json
  <adapter>/<suite>/<prompt-id>.json
```

A new run never overwrites a prior run.

## Suite YAML format

A Promptfoo-shape subset under `suites/<suite-id>.yaml`:

```yaml
description: 'apprentice-eval suite — <topic>'

defaultTest:
  vars:
    agent: apprentice
  assert:
    - type: javascript
      value: 'output.length > 0'

tests:
  - description: '<one-line>'
    id: <stable-id>           # optional; slug derived from description if absent
    vars:
      prompt: |
        <full prompt body>
    assert:
      - type: contains
        value: <substring>
      - type: not-contains
        value: <substring>
      - type: regex
        value: '<regex>'
      - type: equals
        value: <exact-string>
      - type: javascript
        value: 'output.length > 80'
      - type: semantic-similarity
        value: <reference text>
        threshold: 0.75
        weight: 0.5            # default 1.0
```

Every test must include `vars.prompt`. `defaultTest.assert` entries are prepended to each test's assertion list; `defaultTest.vars` is merged underneath each test's vars.

## Win-rate + regression model

Per DESIGN.md §7. Pairwise:

```
result(adapter, prompt) = "win"  if weightedScore(adapter) > weightedScore(base) + epsilon
                          "loss" if weightedScore(adapter) < weightedScore(base) - epsilon
                          "tie"  otherwise
winRate(adapter) := wins / (wins + losses)        # ties excluded
```

Regression flag fires when `priorScore - currentScore > forgettingThreshold` for any prompt the baseline scored > 0. ANY regression flag automatically disqualifies the adapter from canary.

Decision matrix (per `AdapterWinrate.decision`):

| State | Decision |
|---|---|
| `wins + losses == 0` | `reject-no-data` |
| any regression flag | `reject-regression` |
| `winRate < winRateThreshold` | `reject-winrate` |
| else | `promote-canary` |

## Subscription-only constraint

Per `feedback_no_api_key_billing.md`:
- Optional `claude` binary judge for tied outputs runs as a subprocess with `ANTHROPIC_API_KEY` (and other LLM API keys) explicitly cleared from the spawned env.
- `judgeBudget` (default 50) hard-caps subprocess invocations per run.
- `judgeEnabled` defaults to `false`.
- Inference is local Ollama with `mlx_lm.generate` subprocess fallback for older Ollama versions.

## Provider stack + adapter loading

Default: Ollama at `http://127.0.0.1:11434` via `/api/generate`. The harness checks `/api/version` at startup; if Ollama < 0.4 (no `adapter:` field support) and a candidate adapter is configured, it falls back to invoking `python3 -m mlx_lm.generate --model <base> --adapter-path <adapter>` as a subprocess. Both paths are deterministic at `temperature: 0` and a per-prompt seed.

## Testing

```bash
pnpm --filter @chiefaia/apprentice-eval test               # all unit + integration tests
pnpm --filter @chiefaia/apprentice-eval exec vitest run --coverage
```

Coverage targets the directive-flagged modules (suite parser, score computation, win-rate calculator) at 100%; overall package coverage is 85%+. Subprocess paths in `mlx-fallback.ts` and `judge.ts` are intentionally not unit-tested — they're exercised live in `scripts/live-verify.mjs` (Stage 8).

## Live verify

After build, with Ollama running:

```bash
node scripts/live-verify.mjs --suites directive,feedback --cap 2
```

See [`STAGE8-VERIFY.md`](./STAGE8-VERIFY.md) for a sample run + interpretation.

## Preflight check

Before a big run, the retrainer (Phase 4) or operator can run:

```bash
scripts/preflight.sh [--check-adapters]
```

Exits 0 (green), 1 (yellow — warnings), or 2 (red — fatal). Verifies `dist/`, suites, Ollama reachability, and (optionally) Ollama adapter-loading support.

## What this package does NOT do

- Does not load adapters in production traffic — that's Phase 3 (serving).
- Does not trigger training — that's Phase 2.
- Does not auto-promote adapters — eval is a gate, not a dispatcher. Phase 3 + operator approval drive promotion.
- Does not own its own LaunchAgent — the retrainer (Phase 4) calls `harness.evaluate()` programmatically.

## See also

- `agent/memory/apprentice_agent_directive.md` — full Apprentice campaign spec.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule.
- `agent/memory/feedback_monorepo_regression_gate_ergonomics.md` — pnpm regression-gate ergonomics.
- `packages/apprentice-corpus/DESIGN.md` — sibling package; manifest.json shape is the input contract.

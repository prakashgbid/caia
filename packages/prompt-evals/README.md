# `@chiefaia/prompt-evals`

Promptfoo-based eval suites for CAIA agent prompts. Wave 1.2 of the **Enterprise Wave 1** campaign per `agent/memory/enterprise_ai_landscape_directive.md` (W1-2). Closes the missing CI-level agent-output-quality gap with a deterministic, free, fast eval gate.

## What ships

10 YAML eval suites under `evals/` covering the canonical CAIA subagents:

| Suite | Tests | Subject |
|-------|-------|---------|
| `caia-po.yaml` | 8 | Product Owner — decomposition + classification routing |
| `caia-ba.yaml` | 6 | Business Analyst — enrichment + consultation routing |
| `caia-ea.yaml` | 6 | Enterprise Architect — architecture + classification routing |
| `caia-validator.yaml` | 8 | Validator — DoD checks + premature-completion red-flag detection |
| `caia-test-design.yaml` | 5 | Test Designer — plan-design routing |
| `caia-coding.yaml` | 8 | Coding Worker — implementation + PR-flow routing + bypass detection |
| `caia-fix-it.yaml` | 6 | Fix-It — failure-diagnosis + flake-handling routing |
| `caia-steward.yaml` | 6 | Steward Gatekeeper — verdict-routing |
| `caia-mentor.yaml` | 6 | Mentor — lesson-capture routing |
| `caia-curator.yaml` | 6 | Curator — action-routing across 4 output modes |

Total: **65 canonical test cases**.

## Why a deterministic local provider

Subscription-only LLM (no API-key billing per `feedback_no_api_key_billing.md`) means CI cannot call Anthropic. Ollama in CI is impractical (gigabytes per run). We ship `evals/_lib/local-provider.mjs` — a class-shaped Promptfoo provider that inspects prompts deterministically and synthesises structured output the YAML assertions can score against.

Result: CI gate runs in seconds + costs $0, while still detecting prompt-shape drift + assertion drift + bypass-pattern drift (e.g., `--no-verify`, `gh pr update-branch`, `gh pr close`, `it.skip(...)`).

Operators who want richer evals can swap in `ollama:llama3.2:3b` or a custom `claude` shell-out provider locally — the YAML configs are provider-agnostic.

## Library + CLI

```bash
# Run every suite, write JSON summary, exit non-zero on any regression
caia-prompt-evals run --out artifacts/promptfoo-summary.json

# Subset
caia-prompt-evals run --only caia-po,caia-ba

# List discovered suites
caia-prompt-evals list

# View / refresh baselines
caia-prompt-evals baseline           # print all
caia-prompt-evals baseline --all     # refresh all
caia-prompt-evals baseline --update caia-po,caia-ba
```

## Baseline tracking

Each suite has a baseline at `baselines/<agent>.json`:

```json
{
  "agent": "caia-po",
  "passRate": 1,
  "totalTests": 8,
  "recordedAt": "2026-05-06T00:36:29.792Z",
  "regressionTolerance": 0.05
}
```

The CI gate fails when `current.passRate < baseline.passRate - regressionTolerance` for any agent. The default tolerance is 5pp — operators bump baselines manually after intentional changes.

## CI integration

`.github/workflows/promptfoo-eval.yml` runs the suite on every PR + push to develop/main when `packages/prompt-evals/**` or `packages/claude-subagents/**` changes. The job:

1. Installs deps (`pnpm install --frozen-lockfile`).
2. Builds the package (`pnpm --filter @chiefaia/prompt-evals build`).
3. Runs `caia-prompt-evals run --out artifacts/promptfoo-summary.json` — exits non-zero on regression.
4. Uploads `artifacts/promptfoo-summary.json` as a 14-day-retained artifact.

## Operator workflow on regression

1. Inspect the JSON summary (CI artifact or `caia-prompt-evals run --print`).
2. If the change is intentional (e.g., we deliberately deprecated a routing keyword), run `pnpm --filter @chiefaia/prompt-evals exec node dist/cli.js baseline --all` locally, commit the new `baselines/`.
3. If unintended, fix the prompt or the assertion.

## Constraints honoured

- Subscription-only LLM. No API keys. No paid services.
- Deterministic — same prompt always yields same output.
- Mac M-series 16GB primary surface — no GPU, no large model downloads.
- Fast — ≤ 10s per agent suite locally; ≤ 90s for the full 65-test suite in CI.
- Free OSS — Promptfoo is Apache-2.0 (acquired by OpenAI March 2026; still open).

## Adding a new test case

1. Append to `evals/<agent>.yaml`:
   ```yaml
   - description: 'short test name'
     vars:
       prompt: 'the prompt under test'
     assert:
       - type: contains
         value: 'expected fragment'
   ```
2. `caia-prompt-evals run --only <agent>` to verify.
3. `caia-prompt-evals baseline --update <agent>` to bump the baseline if pass-rate changed.

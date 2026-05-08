# `@chiefaia/code-reviewer`

The **blocking** PR code-review agent for the CAIA monorepo. Reviews diffs for **correctness, bugs, style, type safety, test coverage, naming, and comments** and emits a binary `verdict` (`approve` | `request-changes`).

This is the operator-named "Code Reviewer Agent" from `~/Documents/projects/agent-memory/operator_decisions_2026-05-08.md`. It is one of the two AI reviewers required by branch protection on `develop` and `main`. The second is the Architecture/Security Reviewer (Ollama qwen2.5-coder:32b on stolution).

## Sibling agents

This package sits alongside two other PR-review agents in the CAIA fleet. All three are deliberately disjoint by design:

| Package | Block authority | Domain |
|---|---|---|
| `@chiefaia/critic` | BLOCKING | security, regressions, cost overruns, the 18-category failure-mode taxonomy |
| `@chiefaia/code-reviewer` (this package) | BLOCKING | correctness, bugs, style, type safety, test coverage, naming, comments |
| `@chiefaia/reviewer` | ADVISORY-only | craftsmanship (readability, idioms, maintainability) — never blocks |

Code-Reviewer carries static denylists for both siblings' dimension IDs and drops any LLM-volunteered finding that lands on either. See `DESIGN.md §4` for the disjoint-by-construction argument.

## Public API

```ts
import { runCodeReview } from '@chiefaia/code-reviewer';

const review = await runCodeReview({
  prRef: 399,
  repoPath: '/Users/MAC/Documents/projects/caia',
  diff: await fetchDiff(399),
  context: { branch: 'feat/x', baseBranch: 'develop', title: '...' }
});

review.verdict;            // 'approve' | 'request-changes'
review.findings;           // CodeReviewFinding[]
review.blockingFindings;   // findings at or above blockingSeverityThreshold
review.summary;            // counts, redirectsToCritic, redirectsToReviewer
```

For full DI (tests / custom drivers), instantiate `CodeReviewerAgent` directly:

```ts
import { CodeReviewerAgent } from '@chiefaia/code-reviewer';

const agent = new CodeReviewerAgent({
  fs: myFakeFs,
  llm: myFakeLlm,
  enableLlmReasoning: true,
  severityFloor: 'low',
  blockingSeverityThreshold: 'medium'
});
const review = await agent.reviewPR({ prNumber, diff, context });
```

## CLI

```
caia-code-reviewer review --pr <n> [--diff-file <path>] [--output text|json]
                                   [--severity-floor low|medium|high|critical]
                                   [--blocking-threshold low|medium|high|critical]
                                   [--no-llm] [--base-branch <b>] [--branch <b>] [--title <t>]
```

Exit codes:

* `0` — verdict `approve`
* `1` — verdict `request-changes`
* `2` — bad arguments / unrecoverable error

## Subscription-only LLM

The agent spawns the `claude` binary with `claude --print --output-format json --model <tag>`. Per the standing rule in `~/Documents/projects/agent-memory/feedback_no_api_key_billing.md`, the spawn env explicitly **deletes** `ANTHROPIC_API_KEY`. The binary authenticates via the operator's Max subscription account (one of the rotating pool), and per-token billing is impossible by construction.

## Verdict synthesis

`verdict = 'request-changes'` iff `any finding's severity >= blockingSeverityThreshold` (default: `medium`). Otherwise `verdict = 'approve'`.

* **Default blocking threshold is `medium`.** `low`-severity findings (style, naming nits, comment freshness) are surfaced but never block.
* **Severity floor is separately configurable.** Findings below the floor are dropped from the output entirely; the default is `low` (everything kept).

This is the binary verdict the GitHub Action turns into a PR review (approve / request-changes) via `gh pr review`.

## GitHub Action

`.github/workflows/code-reviewer.yml` runs on PR `opened` / `synchronize` / `reopened` / `ready_for_review`. It fetches the diff via `gh pr diff`, runs the agent, posts the verdict as a PR comment, and submits a PR review. The job fails (red CI) when the verdict is `request-changes` so branch protection blocks merge.

## Configuration

All knobs are constructor parameters (Option E shape). Defaults resolve from env vars first, then compile-time CAIA defaults:

| Parameter | Env var | Default |
|---|---|---|
| `conventionsPath` | `CAIA_CONVENTIONS_PATH` | `~/Documents/projects/caia/AGENTS.md` |
| `claudeBinaryPath` | `CLAUDE_BINARY_PATH` | `claude` |
| `modelTag` | `CODE_REVIEWER_MODEL_TAG` | `claude-haiku-4-5-20251001` |
| `maxDiffBytes` | `CODE_REVIEWER_MAX_DIFF_BYTES` | `256000` |
| `chunkBytes` | `CODE_REVIEWER_CHUNK_BYTES` | `64000` |
| `severityFloor` | `CODE_REVIEWER_SEVERITY_FLOOR` | `low` |
| `blockingSeverityThreshold` | `CODE_REVIEWER_BLOCKING_THRESHOLD` | `medium` |
| `perVectorTimeoutMs` | `CODE_REVIEWER_VECTOR_TIMEOUT_MS` | `60000` |
| `maxFindingsPerPr` | `CODE_REVIEWER_MAX_FINDINGS` | `50` |
| `enableLlmReasoning` | `CODE_REVIEWER_LLM_ENABLED` | `true` |
| `enableDeterministic` | `CODE_REVIEWER_DETERMINISTIC_ENABLED` | `true` (Phase 2) |

## Phase status

* **Phase 1 (this PR)**: skeleton + LLM-only review + verdict synthesis + GitHub Action + tests. Deterministic detectors deferred.
* **Phase 2 (planned)**: deterministic-tier detectors for the seven dimensions, scaling the same two-tier pattern Critic and Reviewer use.
* **Phase 3 (planned)**: branch protection wiring on `develop` + `main` (operator-only — see `surface-action.md` in this PR).

## Trail

* Operator decision: `~/Documents/projects/agent-memory/operator_decisions_2026-05-08.md` ## "Branch protection: two AI reviewer agents"
* Phase 1 stop-condition + Option A merge plan: `~/Documents/projects/agent-memory/reviewer_agent_phase1_stop_condition_2026-05-08.md`
* Sibling advisory pattern: `~/Documents/projects/agent-memory/feedback_reviewer_agent_advisory_only_pattern.md`
* Architecture shape: `~/Documents/projects/agent-memory/agent_architecture_shape_2026-05-06.md`
* LLM billing rule: `~/Documents/projects/agent-memory/feedback_no_api_key_billing.md`

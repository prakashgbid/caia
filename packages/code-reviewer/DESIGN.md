# `@chiefaia/code-reviewer` — Design

**Status:** Phase 1 design (LLM-only). Phase 2 will add deterministic detectors. **Trigger:** `operator_decisions_2026-05-08.md` ## "Branch protection: two AI reviewer agents". **Architectural shape:** Option E (`agent_architecture_shape_2026-05-06.md`). **LLM billing:** subscription-only via `claude` binary spawn (`feedback_no_api_key_billing.md`).

## §1. Position in the agent fleet

Three PR-review agents now coexist with deliberately disjoint roles:

```
@chiefaia/critic           — BLOCKING — security/regression/cost (Mentor's 18-cat taxonomy)
@chiefaia/code-reviewer    — BLOCKING — correctness/bugs/style/types/tests/naming/comments
@chiefaia/reviewer         — ADVISORY — craftsmanship (readability, idioms, maintainability)
```

The two BLOCKING reviewers cover separate domains: Critic asks "is this safe to ship?"; Code-Reviewer asks "is this CODE correct?". The ADVISORY Reviewer asks "is this code beautiful?" and never blocks. Together with the Architecture/Security Reviewer (Ollama qwen2.5-coder:32b on stolution, separate package), the two-AI-reviewer setup operator approved is fulfilled by Code-Reviewer + Architecture/Security Reviewer (NOT Code-Reviewer + advisory Reviewer; Reviewer's role is supplementary).

## §2. Public API

```ts
runCodeReview({
  prRef: number | string,
  repoPath: string,
  diff: string,
  context: { branch, baseBranch, title, body?, commitSubjects? },
  config?: CodeReviewerAgentConfig
}) -> Promise<CodeReview>

interface CodeReview {
  prNumber: number;
  reviewedAtIso: string;
  verdict: 'approve' | 'request-changes';
  findings: CodeReviewFinding[];
  blockingFindings: CodeReviewFinding[];
  totalFindings: number;
  summary: ReviewSummary;
}
```

Operator-named in `reviewer_agent_phase1_stop_condition_2026-05-08.md`. The function is a thin wrapper around `class CodeReviewerAgent` for callers that don't need full DI; tests use the class directly to inject fake `fs` / `llm` / `clock`.

## §3. Seven dimensions

The dimensions are taken verbatim from the operator's domain list in `operator_decisions_2026-05-08.md`: "correctness, bugs, style, test coverage, type safety, naming, comments". Mapped 1:1 to seven `CodeReviewDimensionId`s:

| Dimension | Default severity | Description |
|---|---|---|
| `correctness` | `high` | logic errors — off-by-one, wrong operator, missing branch, returns wrong value |
| `bug-risk` | `high` | latent bugs — null/undefined deref, missing await, race condition, unhandled rejection |
| `style` | `low` | enforceable style violations — semicolons, quote style, single-line if-without-braces |
| `type-safety` | `medium` | type errors that compile but are wrong — narrow-then-widen, force-cast, missing null in union |
| `test-coverage` | `medium` | new public behavior shipped without a test that exercises it |
| `naming` | `low` | incorrect / misleading names — `isValid` that returns side-effect status |
| `comments` | `low` | misleading or stale comments — claims `O(n)` on `O(n²)` loop |

Default severity is what the LLM-tier sanitiser uses when the model doesn't volunteer one. The sanitiser also CAPS LLM-suggested severity at the dimension's default — except for `correctness` and `bug-risk` (defaults to `high`), which are allowed to promote to `critical` because real data-loss bugs warrant it.

## §4. Disjoint-by-construction with siblings

Code-Reviewer must not duplicate Critic or advisory Reviewer findings. Three layers of defense:

**Layer 1 — system prompt.** The LLM prompt explicitly enumerates Critic's 18 failure-mode IDs and Reviewer's 16 craftsmanship dimensions, and instructs the model to STAY IN ITS LANE. Verbatim from `src/llm-reasoner.ts`:

> CRITICAL — STAY IN YOUR LANE:
> (1) Do NOT flag any of these — they belong to the sibling Critic agent: security regressions, credential leaks, cost overruns, ...
> (2) Do NOT flag stylistic-only refactors that don't have a correctness component — they belong to the advisory Reviewer agent: pure idiom adherence, abstraction quality, ...

**Layer 2 — sanitiser drop.** `parseLlmOutput` -> `sanitiseLlmFinding` checks the `dimension` field against `CRITIC_DENYLIST` and `ADVISORY_REVIEWER_DENYLIST` and drops anything that lands on either set.

**Layer 3 — merger drop + count.** `mergeFindings` re-checks the same denylists and increments `summary.redirectsToCritic` / `summary.redirectsToReviewer`. Surfacing the count lets operators see if the LLM is wandering — and the drop is hard-coded (the merger doesn't trust upstream layers to have already filtered).

Three layers because LLM compliance with prompt instructions is statistical, not deterministic. Same lesson as Reviewer's `feedback_reviewer_agent_advisory_only_pattern.md` Rule 2.

## §5. Verdict synthesis

```
verdict = blockingFindings.length > 0 ? 'request-changes' : 'approve'
where blockingFindings = findings.filter(f => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[blockingSeverityThreshold])
```

Default `blockingSeverityThreshold` is `medium`. So:

* `low`-severity findings (style nits, naming nits, comment freshness) → surfaced but never block.
* `medium` and above → block (request-changes).

This matches the operator's intent. The advisory Reviewer carries everything as nit/suggestion/consider with NO `blockingFindings` field — that agent's static guarantee. Code-Reviewer's verdict is what the GitHub Action turns into a `gh pr review --approve` / `gh pr review --request-changes`.

## §6. LLM-reasoned tier

* **Binary:** `claude --print --output-format json --model claude-haiku-4-5-20251001` (configurable). Haiku-4.5 chosen as the default because correctness/bug review is well within Haiku's capability and the cost-per-token (vs. Sonnet) is meaningfully lower against the subscription's weekly cap.
* **Subscription-only:** `delete env['ANTHROPIC_API_KEY']` before spawn. Per `feedback_no_api_key_billing.md`, the agent must NEVER fall through to per-token billing. The CI workflow uses `CLAUDE_OAUTH_TOKEN` to authenticate the binary against the operator's Max account.
* **Hallucination guard:** drop any LLM finding whose `excerpt` (first 40 chars) isn't actually present in the concatenated diff text. Catches the model inventing line numbers / file paths.
* **Chunking:** large hunks are split via `chunkHunk(maxBytes)` to a default of 64 KB per chunk (Datadog BewAIre lesson, also used by Critic and Reviewer).
* **Failure modes:** spawn error / non-zero exit / parse error → `{ ok: false, diagnostic, findings: [] }`. The agent surfaces `summary.llmReasoningSucceeded: false` so operators can see when LLM quality wasn't available; the verdict in that case defaults to `approve` (no blockers found because none could be evaluated). Phase 2's deterministic tier will be a non-LLM safety net.

## §7. Deterministic tier (Phase 2)

Reserved for Phase 2. Will mirror the two-tier pattern from `@chiefaia/critic` (`feedback_critic_agent_two_tier_detector_pattern.md`) and `@chiefaia/reviewer` (`feedback_reviewer_agent_advisory_only_pattern.md`):

* `correctness` — strict-equality misuse (`==` for primitives), unhandled awaited rejection patterns
* `bug-risk` — `Promise<...>` returned but not awaited, `undefined` used as truthy guard
* `type-safety` — explicit `as any`, `!.` non-null assertion in untyped context (already partly covered by the advisory `type-any` detector but tilted toward correctness here)
* `test-coverage` — public export added with no `*.test.ts` change in the same PR
* `naming` — semantic naming smells (`isXxx` that mutates, plural for singular)
* `style` — only project-explicit rules (semicolons, quote style)
* `comments` — comments asserting algorithmic complexity that the diff invalidates

Phase 1 ships LLM-only because the LLM tier alone is sufficient to demonstrate the pipeline end-to-end. Phase 2 adds the safety net so the agent works even when LLM is rate-limited.

## §8. Test strategy

Phase 1 tests cover:

* `diff-parser.test.ts` — happy-path, added/deleted/renamed, multi-file, binary-skip, empty
* `chunk-hunk` and `walk-hunk` — boundary behavior
* `config.test.ts` — all env-var paths, all explicit overrides, expandHome
* `fs-reader.test.ts` — exists/readFile/readDir on tmp tree
* `conventions-loader.test.ts` — heading allow-list, empty-section skip, fake-fs
* `llm-reasoner.test.ts` — prompt build, JSON parsing, denylist drops, severity capping, subscription-env-strip, spawn failure paths
* `merger.test.ts` — verdict synthesis, denylist enforcement, severity floor, sort, cap, dedup, summary
* `finding-id.test.ts` — determinism, sensitivity to all four inputs
* `agent.test.ts` — end-to-end with fake LLM, hallucination guard, LLM failure recovery, runCodeReview entrypoint
* `types.test.ts` — invariants on dimension count, denylist disjointness, severity rank monotonicity

Coverage target: **≥ 80%** on `src/**/*.ts` excluding `cli.ts`.

Stop condition (per `reviewer_agent_phase1_stop_condition_2026-05-08.md`): if coverage drops below 80% on this package, STOP and add tests before merge.

## §9. Branch protection follow-up (operator-only)

Wiring branch protection on `develop` and `main` to require both Code-Reviewer's review AND the Architecture/Security Reviewer's review for merge is a permission change — operator-only per safety rules. Surfaced in this PR's body as a follow-up. Implementation plan once operator authorizes:

1. GitHub App or scoped bot PAT for Code-Reviewer (Vault-stored, scoped to PR-approval only — no push, no admin).
2. Same for Architecture/Security Reviewer (separate identity to keep approvals distinct).
3. Branch protection: require 2 approvals from the AI-reviewer designated set; require Code Reviewer status check pass.
4. Mitigations for bot-PAT compromise: 90-day rotation, weekly Loki audit (per `operator_decisions_2026-05-08.md`).

## §10. References

* `~/Documents/projects/agent-memory/operator_decisions_2026-05-08.md` ## Branch protection: two AI reviewer agents
* `~/Documents/projects/agent-memory/reviewer_agent_phase1_stop_condition_2026-05-08.md` — Phase 1 stop-condition + Option A merge plan
* `~/Documents/projects/agent-memory/feedback_reviewer_agent_advisory_only_pattern.md` — sibling advisory pattern (Reviewer)
* `~/Documents/projects/agent-memory/feedback_critic_agent_two_tier_detector_pattern.md` — sibling two-tier pattern (Critic)
* `~/Documents/projects/agent-memory/agent_architecture_shape_2026-05-06.md` — Option E
* `~/Documents/projects/agent-memory/feedback_no_api_key_billing.md` — subscription-only

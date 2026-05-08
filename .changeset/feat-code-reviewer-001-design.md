---
"@chiefaia/code-reviewer": minor
---

feat(code-reviewer-001): @chiefaia/code-reviewer Phase 1 — blocking PR code-review agent

New private package `@chiefaia/code-reviewer` shipped per
`operator_decisions_2026-05-08.md` ## "Branch protection: two AI reviewer
agents". Sibling to `@chiefaia/critic` (security/regression/cost — also
blocking) and `@chiefaia/reviewer` (advisory craftsmanship — never blocks).

**Public API**

```ts
runCodeReview({ prRef, repoPath, diff, context }) -> Promise<CodeReview>
// CodeReview { verdict: 'approve'|'request-changes', findings, blockingFindings, ... }
```

**Phase 1 (this PR) — LLM-only**

- Seven dimensions: correctness, bug-risk, style, type-safety, test-coverage,
  naming, comments (operator-named in `operator_decisions_2026-05-08.md`)
- Subscription-only LLM via `claude --print --output-format json` —
  `delete env['ANTHROPIC_API_KEY']` per `feedback_no_api_key_billing.md`
- Verdict synthesis: `request-changes` iff any finding ≥ blockingSeverityThreshold
  (default `medium`). Low-severity findings surface but don't block.
- Disjoint-by-construction with siblings — three layers of denylist
  enforcement (system prompt + sanitiser + merger). Mirrors the standing
  pattern from `feedback_reviewer_agent_advisory_only_pattern.md` Rule 2.
- Hallucination guard, large-diff chunking, conventions loading — same
  primitives as Critic/Reviewer.
- 94 tests, 94.5% statement coverage.
- GitHub Action `.github/workflows/code-reviewer.yml` runs on PR open/sync,
  posts verdict comment, submits `gh pr review --approve` /
  `--request-changes`, fails CI on request-changes (blocks merge).

**Phase 2 (planned)**

- Deterministic-tier detectors mirroring Critic's two-tier pattern.
- Branch protection wiring to require both Code-Reviewer and the
  Architecture/Security Reviewer (Ollama qwen2.5-coder:32b on stolution).
  Branch-protection modification is operator-only — surfaced for
  authorization in this PR's body.

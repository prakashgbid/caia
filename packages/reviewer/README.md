# `@chiefaia/reviewer`

Craftsmanship-focused PR review agent for the CAIA monorepo. Posts advisory feedback (readability, idioms, maintainability) as PR comments. **Never blocks merges** — that's Critic's job.

## Position in the agent ecosystem

| Agent | Question it answers | Output severity | Blocks merges? |
|---|---|---|---|
| `@chiefaia/critic` | "What could go wrong?" | low / medium / high / critical | Yes (severity ≥ high) |
| `@chiefaia/reviewer` | "How could this be cleaner?" | praise / nit / suggestion / consider | No, ever |

Reviewer runs after Critic passes; the two agents produce disjoint findings by construction (Reviewer's merger has an explicit denylist of Critic's 18 failure-mode categories). Recurring Reviewer suggestions graduate to Steward rules via Mentor's clustering pipeline (the "advisory → enforcement" path).

## Install (already a workspace member)

```bash
pnpm --filter @chiefaia/reviewer build
pnpm --filter @chiefaia/reviewer test
```

## Programmatic usage

```typescript
import { ReviewerAgent } from '@chiefaia/reviewer';

const reviewer = new ReviewerAgent({
  // All optional — CAIA defaults filled in.
  conventionsPath: '~/Documents/projects/caia/AGENTS.md',
  severityFloor: 'suggestion',
  maxFunctionLines: 60,
  maxFileLines: 500,
  maxNestingDepth: 4,
});

const review = await reviewer.reviewPR({
  prNumber: 393,
  diff: '<unified diff>',
  context: { branch: 'feat/x', baseBranch: 'develop', title: 'feat: ...' }
});

// review.findings = list of CraftsmanshipFinding (advisory only)
// review.summary  = ReviewSummary
// NO blockingFindings field — Reviewer is advisory by design.
```

## CLI

```bash
caia-reviewer review --pr 393                                    # use defaults
caia-reviewer review --pr 393 --severity-floor consider          # noise filter
caia-reviewer dry-run --diff-file ./pr.diff --no-llm             # offline / deterministic-only
caia-reviewer dry-run --diff-file ./pr.diff --output json        # machine-readable
```

## Architecture (two-tier, parallel to Critic)

```
diff -> DiffParser -> { Deterministic detectors (10) || LLM-reasoned (8) } -> Merger -> CraftsmanshipReview
```

The 18 dimensions split:

**Deterministic tier (10)** — regex / line-walk:
naming-convention, function-length, file-length, comment-density, magic-numbers, duplicate-imports, deep-nesting, todo-without-ticket, console-logging, type-any.

**LLM-reasoned tier (8)** — claude binary subprocess, subscription-only:
idiom-adherence, abstraction-quality, suggested-refactor, test-design, error-handling-style, architecture-pattern, documentation-quality, api-ergonomics.

Subscription-only: every spawn explicitly `delete env['ANTHROPIC_API_KEY']` before calling `claude --print --output-format json`. Test seam: `spawnFn` constructor option.

## Severity scale

| Severity | Meaning | Default for |
|---|---|---|
| `praise` | Exemplary craftsmanship — surfaces wins first in CLI output | LLM-emitted only |
| `nit` | Pure cosmetic — author can ignore freely | naming-convention, duplicate-imports, todo-without-ticket |
| `suggestion` | Improves readability with low effort | comment-density, magic-numbers, deep-nesting, console-logging, test-design, error-handling-style, documentation-quality |
| `consider` | Meaningful refactor opportunity, low risk | function-length, file-length, type-any, idiom-adherence, abstraction-quality, suggested-refactor, architecture-pattern, api-ergonomics |

Severity floor defaults to `nit` — everything surfaces. Raise to `suggestion` or `consider` to cut noise.

## Differentiation from Critic — explicit guard

Reviewer's merger has a `CRITIC_DENYLIST` of all 18 Critic failure-mode IDs. Any LLM-reasoned finding whose `dimension` happens to land on that denylist is dropped before merge with a `redirect-to-critic` count. Defense-in-depth on top of the prompt-level non-overlap instruction.

E2E verification on 5 recently-merged PRs measured **0% overlap** between Critic and Reviewer findings. See `~/Documents/projects/reports/reviewer-agent-e2e-verification-2026-05-06.md`.

## Tests

55 unit + integration tests, 93.33% statement coverage / 89.36% function coverage. Test seams (constructor DI):

- `fs` — `FsReader` for AGENTS.md / conventions reading
- `llm` — `LlmReviewer` for the LLM-reasoned tier (tests inject a stub)
- `clock` — `() => Date` for stable id-hash

```bash
pnpm --filter @chiefaia/reviewer test
pnpm --filter @chiefaia/reviewer test:watch
```

## See also

- `DESIGN.md` — full design rationale
- `~/Library/Application Support/.../agent_ecosystem_expansion_directive.md` ## A2 — Reviewer Agent slot
- `~/Library/Application Support/.../feedback_critic_agent_two_tier_detector_pattern.md` — sibling pattern
- `packages/critic/` — sibling adversarial agent
- `~/Documents/projects/reports/reviewer-agent-e2e-verification-2026-05-06.md` — live verification on 5 PRs
- `~/Documents/projects/reports/reviewer-agent-complete-2026-05-06.md` — completion doc

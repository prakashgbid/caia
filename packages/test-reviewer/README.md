# @caia/test-reviewer

Stage 11 of the canonical CAIA pipeline — the **Tests Review Gate**.

Audits the `ticket.testCases` set produced by the Test Author agent (Stage 10)
against the strategy declarations the Testing Architect emitted into the
composed `tickets.architecture.testing.*` slice. On pass, the orchestrator
transitions the ticket from `tests-authored` → `tests-reviewed`. On fail, it
chains `tests-authored` → `tests-reviewed` → `tests-review-failed`, and the
Test Author re-runs.

Mirrors `@caia/ea-reviewer` exactly — same lens architecture, same decision
envelope, same DI seams. The only difference is _what_ it audits.

## Four audit lenses

- **AC coverage** — every `ticket.acceptance_criteria[i]` has at least one
  `TestCase` with `linkedAcceptanceCriterionIndex === i` AND
  `category === 'happy'`. Missing AC → P1 rerun directive on `test-author`.
- **Pyramid balance** — per-layer test mix is compared against the Testing
  Architect's `testing.testTypeMixPercentages[ticketType]`. Layers far
  below target (< 50% of declared share) fire P1; layers far above (> 200%)
  fire P2 advisories. The architect's hard floors (`unit ≥ 30`, `e2e ≤ 50`)
  are enforced as P1 even when the architect's mix is absent.
- **Edge cases** — `testCases.filter(c => c.category === 'edge').length >=
  max(1, floor(totalCases / 10))`. Missing edge-case coverage → P1.
- **Error states** — at least one `category === 'error'` test, plus
  conditional quality-tag floors: if `architecture['a11y.wcagLevel']` is
  set, require ≥1 accessibility test; if `architecture['security.dataClassification']`
  is `PII | confidential`, require ≥1 security test.

Plus the **correctness lens** (LLM-judge) for case quality — wired behind a
`CriticAdapter` DI seam. Default: `NullCriticAdapter`. Production:
`@chiefaia/claude-spawner` subscription-only adapter (per P14).

## Decision envelope

```ts
{
  decision: 'pass' | 'fail',
  finalState: 'tests-reviewed' | 'tests-review-failed',
  rerunAuthor: RerunDirective[],   // ← orchestrator dispatches to test-author
  advisories: Advisory[],          // ← dashboard surfaces these
  findings: { acCoverage, pyramid, edge, error, correctness },
  summary: string,
}
```

## State machine

```
tests-authored
   │
   ├── pass ───► tests-reviewed                  (single transition)
   │
   └── fail ───► tests-reviewed                  (intermediate, payload.intermediate=true)
                   │
                   └──► tests-review-failed      (canonical recovery target)
```

Per `@caia/state-machine`'s transition table:
- `tests-authored → tests-reviewed`
- `tests-reviewed → tests-review-failed`
- `tests-review-failed → tests-authored` (Test Author re-runs)

## Spec

Sourced from:
- `research/state_machine_handoff_spec_2026.md` (canonical pipeline)
- `research/caia_v3_final_plan_2026.md` (Stage 11 ownership)
- `research/17_architect_framework_spec_2026.md` §6 (reviewer pattern)
- Plan: `plans/plan-2026-05-24-test-reviewer-subagent.md`
- Submission: `plans/_submissions/test-reviewer-stage-11-2026-05-25.json`

Submitted via `@caia/ea-architect.submitPlan` per CAIA constitutional process
(PR #568); status: approved.

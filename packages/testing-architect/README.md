# @caia/testing-architect

Architect #16 of CAIA's 17-architect EA fan-out. Senior QA architect focused on testing STRATEGY: pyramid balance, fixture discipline, mutation testing thresholds, perf-regression budgets, Playwright conventions.

## What it owns

`testing.*` slice of the `tickets.architecture` JSONB column:

- `testing.testingStrategy` — pyramid shape (broad-base default), rationale, risk areas, author + reviewer ownership
- `testing.testTypeMixPercentages` — per-ticket-type mix (unit / integration / e2e / visual / a11y / perf) summing to 100
- `testing.fixturesStrategy` — golden datasets, factory patterns, per-test seeding, determinism
- `testing.mutationTestingThresholds` — Stryker default, kill-score floor 60% (>=50% hard min)
- `testing.perfRegressionBudgets` — Lighthouse delta 5% default (<=10% hard cap), k6 thresholds
- `testing.e2ePatterns` — Playwright 1.59.x, page-object pattern mandatory, Browserless integration
- `testing.coverageThresholds` — per-ticket-type + global floor (80/75/80/80 default, >=70 hard min)
- `testing.flakeTolerance` — 0.5% max retry rate (<=2% hard cap), quarantine policy, deflake owner

## What it does NOT do

The Testing Architect sets **strategy only**. It is DISTINCT from:

- **Test Author Agent** — writes the actual test CASES per story (consumes this strategy verbatim).
- **Test Reviewer Agent** — audits coverage against this strategy.

No test code. No test case generation. No coverage auditing. Just the strategy.

## Upstream dependencies

Wave-2 architect. Reads from Frontend + Backend + Database.

## Precedence

Rank 17 per spec section 5.2 — lowest. Testing is strictly advisory.

## Testing

```bash
pnpm test        # full Vitest suite (>=30 tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

## Related packages

- `@chiefaia/test-kit` — test utilities + mocks reused by the Test Author Agent
- `@chiefaia/test-isolation` — per-test SQLite + ports
- `@chiefaia/playwright-config` — locked Playwright + Browserless config factory

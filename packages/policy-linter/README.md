# @caia/policy-linter

Layer 1 of the AI-First Continuous-Discipline framework. Encodes locked
operator feedback memories as code-as-policy gates. Deterministic backstop
for the EA Architect (Layer 2, mutating); this is the validating layer.

Spec: research/ai_first_continuous_discipline_2026.md Layer 1.

## The 7 policies

- no-calendar-time-estimates (soft-fail, feedback-no-timelines / p003)
- auto-merge-prs (hard-fail, ADR-005 / p005)
- subscription-only-build (hard-fail, ADR-001/003/041 / p001+p002+p009)
- ea-agent-gate (hard-fail, ADR-015 / p006)
- dod-stewards-green (hard-fail, PR #567 state-machine + PR #566 activation-steward + 4 stewards)
- shadcn-not-mui (hard-fail, ADR-061 / p012)
- no-idle-research (soft-fail, feedback-no-idle-no-waiting + feedback-action-research-outputs / p004+p008)

## CLI

  pnpm --filter @caia/policy-linter build
  npx caia-policy-lint path/to/brief.md --format markdown --intent build --target-repo caia

Exit codes: 0 pass/advisory, 1 soft-fail, 2 hard-fail.

## Programmatic surfaces

- `PolicyEngine` and `defaultPolicies` from `@caia/policy-linter`.
- `runPolicyPreflight` from `@caia/policy-linter/dispatch-hook` (chain-runner preflight).
- `renderGithubActionsStep` and `formatAnnotation` from `@caia/policy-linter/ci-action`.

Emits `policy.check.completed` and `policy.violation.detected` via `@chiefaia/events`.

## Tests

130+ vitest tests covering each policy pass / fail / remediation, plus
engine, CLI, hook, CI-action, and integration. Run:

  pnpm --filter @caia/policy-linter test

Integration test at `tests/integration/baseline-last-24h.test.ts` runs the
linter against every brief touched in the last 24h under
`~/Documents/projects/agent-memory/` and prints baseline violation rates.

## Out of scope this PR

- Wiring into `@chiefaia/chain-runner` preflight (~50 LOC follow-up).
- Remaining 5 spec policies (p007 / p010 / p011 / granular splits).
- Discipline-Monkey quarterly chaos cron.

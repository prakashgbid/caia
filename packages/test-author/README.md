# @caia/test-author

**Stage 10 of CAIA's canonical pipeline — Test Author Agent.**

Reads each EA-approved ticket (`status = 'ea-complete'`, composed
`tickets.architecture` JSONB populated by the 17 specialist architects
including [`@caia/testing-architect`](../testing-architect)'s
`testing.*` strategy) and emits the per-story `ticket.testCases` JSONB
plus `ticket.testDesign` metadata.

Cases are Gherkin-flavoured (`given` / `when` / `then`) and carry a
`category` (`happy | edge | error | accessibility | security |
performance | visual`) plus a `layer` (`unit | integration | e2e |
visual | accessibility`) so the downstream Test Runner
([`@caia/per-story-tester`](../per-story-tester), Stage 14) can
deterministically translate them to **vitest** (unit + integration),
**Playwright** (e2e + visual), **axe** (accessibility), and
**Lighthouse** (performance) source code. Performance cases embed the
Lighthouse thresholds extracted from
`architecture.testing.perfRegressionBudgets`.

## Pipeline position

```
… → ea-complete  ──[@caia/test-author]──▶  tests-authored
                                              │
                                              ├─[@caia/test-reviewer]─▶  tests-reviewed
                                              └─ tests-authored → tests-authoring-failed  (chained fail path)
```

The agent transitions a ticket from `ea-complete` to `tests-authored`
on success. On failure, the canonical FSM
([`@caia/state-machine`](../state-machine)) requires routing through
`tests-authored` first, so the api.ts wrapper emits the two-row chain
`ea-complete → tests-authored → tests-authoring-failed`.

## Sibling clear

| Package | Stage | Role |
|---|---|---|
| `@caia/testing-architect` (PR #565) | EA fan-out, architect #16 | Sets the `testing.*` STRATEGY. Does NOT write cases. |
| **`@caia/test-author` (this package)** | **Stage 10** | **Writes the `ticket.testCases` CASES.** |
| `@caia/test-reviewer` (PR #573) | Stage 11 | Audits the case set against the strategy. Cannot write. |
| `@caia/per-story-tester` (PR #569) | Stage 14 | Runs the cases against the Full-Stack Engineer's code. |

## Usage

```ts
import { authorTests } from '@caia/test-author';

const outcome = await authorTests('ticket-pt-test-001', {
  store: myTicketStore,                  // loadTicket + writeTestCases
  architectureStore: myArchitectureStore, // loadArchitecture (optional)
  stateMachine: myStateMachine            // transition (optional)
});

console.log(outcome.output.testCases);   // Gherkin TestCase[]
console.log(outcome.output.testDesign);  // metadata
console.log(outcome.emittedTransitions); // canonical state-machine hops
```

### Submitting a plan to the EA Architect

The package includes a `scripts/submit-plan.mjs` that submits
`PLAN.md` to `@caia/ea-architect.submitPlan` (PR #568 — operational
framework). Run with `CAIA_EA_STUB=1` for autonomous CI:

```bash
CAIA_EA_STUB=1 pnpm --filter @caia/test-author ea:submit-plan
```

## Heuristics

Encoded in the system prompt and asserted by `@caia/test-reviewer`:

- **Pyramid balance** — split case counts by
  `architecture.testing.testTypeMixPercentages[ticket.type]`. Reject
  100% unit / 0% e2e.
- **AC coverage floor** — every `ticket.acceptance_criteria[i]` must
  be referenced by at least one case via
  `linkedAcceptanceCriterionIndex`.
- **Edge floor** — at least `max(1, ceil(totalCases / 10))` cases with
  `category: 'edge'`.
- **Error floor** — at least one `category: 'error'` per entry in
  `architecture.backend.errorEnvelope.mapping`.
- **A11y gate** — `architecture.a11y.wcagLevel` ≥ AA ⇒ ≥1
  `accessibility` case at `layer: 'accessibility'`.
- **Perf gate** — `architecture.testing.perfRegressionBudgets` set ⇒
  ≥1 `performance` case with Lighthouse threshold embedded in `then`.
- **Determinism** — every `selectorHints[i]` is a stable test-id /
  role selector (no `nth-child`, no auto-generated class names).
- **Bounds** — total cases capped at
  `MAX_TEST_CASES = 50`
  ([`@chiefaia/ticket-template`](../ticket-template)); soft floor of 3.

## Subscription posture

True-Zero / Claude Max. All LLM calls flow through
`@chiefaia/claude-spawner`, which scrubs `ANTHROPIC_API_KEY`-style
env vars before spawning. API-key billing is blocked at the spawner
layer.

## Build

```bash
pnpm --filter @caia/test-author typecheck
pnpm --filter @caia/test-author build
pnpm --filter @caia/test-author test
pnpm --filter @caia/test-author lint
```

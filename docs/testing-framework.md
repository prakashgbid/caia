# Testing Framework — Phase A flow

> **Status:** Phase A (story-driven test-case generation) is shipped and
> verified end-to-end.
> **Verification gate:**
> `apps/orchestrator/tests/testing-framework-e2e.test.ts`. If that file
> passes, this document is accurate.

## What it is

The testing framework turns every story produced by the Phase-1 pipeline
into an executable test plan. **Phase A** is the *test designer* — the
Testing Agent reads the BA-enriched ticket and generates a typed
`test_cases` array. **Phase B** (specced in
`reports/testing-framework-architecture-2026-04-28.md`, not yet
implemented) is the *test runner* — it translates each `test_case` into
Playwright/vitest source code and executes it.

## Pipeline slot

```
prompt.received
    ▼
ingested → scaffolded → po_decomposed → ba_enriched
    ▼
test_designed   ← Test-Design Agent runs here (TEST-005)
    ▼
bucket_placed → ready_for_pickup
```

The Testing Agent runs once per prompt, after the BA agent finishes
its cross-agent enrichment round and before the Task Manager places
tickets into buckets.

## Data model

| Surface | Field | Notes |
|---|---|---|
| `@chiefaia/ticket-template` | `testCases: TestCase[]` | Bounded `[0, 50]`. See `TestCase` below. |
| `@chiefaia/ticket-template` | `testDesign: { designedBy, designedAt, totalCases, categoryCounts, notes }` | Optional metadata block stamped by the agent. |
| `stories` (migration 0026) | `test_cases_json` (text default `'[]'`) | Mirror of `ticket.testCases` for cheap dashboard queries. |
| `stories` (migration 0026) | `test_designed_at` (integer, epoch ms) | Mirrors `ticket.metadata.testDesignedAt`. |
| `stories` (migration 0026) | `test_design_status` (text) | `pending | designed | skipped | error` — drives the dashboard pickup query. |
| `prompt_pipeline_stages` | `stage = 'test_designed'` row | Inserted by the Test-Design Agent on completion (TEST-005). |
| `events` | `test.cases_generated` | One per story when the agent finishes. |
| `events` | `test.case_added` | One per case, fired as the agent builds the array. |

### `TestCase` shape

```ts
interface TestCase {
  id: string;                                    // unique within a ticket
  title: string;                                 // human-readable summary
  category:
    | 'happy' | 'edge' | 'error'
    | 'accessibility' | 'security' | 'performance' | 'visual';
  layer: 'unit' | 'integration' | 'e2e' | 'visual' | 'accessibility';
  given: string;                                 // Gherkin precondition
  when:  string;                                 // Gherkin action
  then:  string;                                 // Gherkin outcome
  linkedAcceptanceCriterionIndex?: number;
  selectorHints?: string[];                      // CSS/aria selectors
  mocks?: Array<{ method, url, status, body }>;  // installed via page.route()
  required?: boolean;                            // gates story `done`
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped' | 'flaky';
  designedBy: string;                            // 'test-design-agent'
  designedAt: number;                            // epoch ms
}
```

The schema is enforced by `@chiefaia/ticket-template`'s Zod validator;
the agent mode-checks its own output before persisting and rejects
designs that fail validation.

## Generation strategy

Rule-based, deterministic mapping from BA-enriched fields to a base
set of cases:

- **Happy** — one per acceptance criterion, with the AC index linked.
- **Edge** — keyed off `agentSections.api / .ui / .database`.
- **Error** — same; includes 4xx/5xx mocks for API stories.
- **Accessibility** — only if `agentSections.ui` is present; one axe-core
  case + one keyboard-navigation case + up to three from
  `accessibilityRequirements`.
- **Security** — if `agentSections.security` or `.api` is present
  (covers 403 vs 401 distinction + required-headers verification).
- **Performance** — if `.api` or `.ui` is present (response time + LCP
  budgets).
- **Visual** — only if `.ui` is present (desktop + mobile snapshots).

All factories are pure functions and are tested individually
(`apps/orchestrator/tests/agents/test-design-agent.test.ts`).

The agent caps total cases at 50 (`MAX_TEST_CASES`) to keep runner
wallclock predictable for Phase B. Re-running on a story already in
`designed` state is a no-op.

## Agent invocation

The Testing Agent is wired into the scaffolder's chain after BA agent
completes. The full chain (TEST-005):

```
PO → EA → BA → Test-Design → Task Scheduler
```

The agent advances the prompt-level pipeline stage to `test_designed`
once it has visited every valid story (designed, skipped, or errored).
Per-story state lives on `stories.testDesignStatus`; the prompt-level
stage never regresses.

## API surface

```ts
import {
  runTestDesignAgent,
  designTestCasesForTicket,
} from '../agents/test-design-agent';

// Drive the chain (production wiring; called by scaffolder)
await runTestDesignAgent({ promptId, correlationId }, db);

// Pure designer — no DB; call from tests / future LLM augmentation
const { testCases, testDesign } = designTestCasesForTicket(ticket, {
  storyId, promptId, correlationId,
});
```

## Dashboard surface

`/stories/[id]` (TEST-006) renders the test cases inline below the
agent sections:

- Per-category and per-status badge breakdown
- Per-case row with given/when/then + status pill + layer badge
- `optional` marker for cases with `required: false`
- `designedBy` + `designedAt` attribution on the section header
- Live updates via WebSocket; the `test.` event prefix triggers a refetch

## Testing

| Suite | What it covers |
|---|---|
| `tests/agents/test-design-agent.test.ts` | 16 unit + integration tests on the agent itself |
| `tests/agents/test-design-pipeline.test.ts` | Integration: BA → Test-Design → stage advancement |
| `tests/api/ticket-bundle.test.ts` | Bundle endpoint round-trips `testCases` + `testDesign` |
| `tests/testing-framework-e2e.test.ts` | **Acceptance gate** — full prompt-to-test-cases flow end-to-end |

Run the verification gate:

```sh
cd /Users/MAC/Documents/projects/caia
pnpm --filter @caia-app/core exec jest \
  --roots='<rootDir>/tests' \
  --testPathPattern='testing-framework-e2e' \
  --no-coverage
```

Full sweep (covers Phase 1 + testing framework):

```sh
pnpm --filter @caia-app/core exec jest \
  --roots='<rootDir>/tests' \
  --testPathPattern='phase1-e2e|testing-framework|test-design|pipeline-stages|ticket-bundle' \
  --no-coverage
```

## What's next (Phase B — specced, not implemented)

`reports/testing-framework-architecture-2026-04-28.md` documents the
parallel-browser-testing architecture and the Phase B PR list:

- **TEST-101** — Test Runner Agent. Translates each `test_case` into
  Playwright/vitest source and runs it.
- **TEST-102** — Browserless on stolution remote (Docker, 30 concurrent
  sessions). Self-hosted, $0 recurring.
- **TEST-103** — Per-test ephemeral SQLite + isolated localhost ports.
- **TEST-104** — DoD enforcement: a story can't transition to `done`
  until every required case has a `passed` row in `test_case_runs`.

Phase B PRs land when the Phase 2 worker pool is built.

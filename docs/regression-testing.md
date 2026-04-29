# CAIA pipeline regression testing

> The safety net for every future pipeline + agent change. Read this
> file before adding or modifying an agent.

The Phase 2 pipeline regression suite is the contract that proves the
pipeline still works end-to-end after any change. It lives in
`apps/orchestrator/tests/e2e/`:

```
tests/e2e/
├── _helpers/                  # shared scaffolding (db, judge, worktree, bundle, pipeline driver)
├── pipeline/                  # full-pipeline scenarios
│   ├── happy-path.test.ts                       # PHASE2E-001
│   ├── diverse-prompts.test.ts                  # PHASE2E-002 (10 scenarios)
│   ├── validator-rejection-recovery.test.ts     # judge fail-then-recover + escalation
│   ├── fix-it-loop-with-retries.test.ts         # fail-then-pass per case → tested_and_done
│   └── fix-it-loop-escalation.test.ts           # all-fail → fix_loop_escalated
└── agents/                    # per-agent contract regressions
    ├── po-agent.regression.test.ts
    ├── ba-agent.regression.test.ts
    ├── ea-agent.regression.test.ts
    ├── validator.regression.test.ts
    ├── test-design.regression.test.ts
    ├── task-manager.regression.test.ts
    ├── coding-agent.regression.test.ts
    └── fix-it-test.regression.test.ts
```

## When to add a regression test

Any time the answer to one of these questions is "yes":

- **Are you changing an agent's contract?** (input shape, output
  shape, required event types, persisted columns, status transitions,
  retry behavior, escalation behavior)
- **Are you adding a new pipeline stage** or moving an existing
  stage's owner?
- **Are you fixing a bug** that surfaced because of a missing assertion?
  → add a regression test for the bug, not just the fix.
- **Are you introducing a new failure mode** (e.g. new escalation
  path, new blocker kind, new event)?
- **Are you adjusting an existing test's pass criteria** to match new
  behavior? → make sure the new behavior is actually correct first;
  often it's a sign you should *add* a test for the old behavior on
  legacy fixtures.

If yes, the PR must include the new/updated regression test in the
same diff. Reviewers should reject changes-to-agents-without-tests.

## Running locally

```bash
# Whole regression suite (pipeline + agents)
pnpm test:regression

# Just the full-pipeline scenarios
pnpm test:regression:pipeline

# Just the per-agent contract tests
pnpm test:regression:agent
```

The full suite completes in ~10s on a developer laptop. CI runs both
jobs in parallel.

## Adding a new pipeline scenario

1. Create `apps/orchestrator/tests/e2e/pipeline/<scenario>.test.ts`.
2. Import the helpers:
   ```ts
   import { createTestDb, wireBusToTestDb } from '../_helpers/db';
   import { drivePipeline } from '../_helpers/pipeline';
   import { makeAlwaysPassJudge, makeRecoveringJudge,
            makeAlwaysFailJudge } from '../_helpers/judge';
   import { makeFakeWorktree } from '../_helpers/worktree';
   import { ticketBundleToCoderBundle } from '../_helpers/bundle';
   ```
3. Drive the pipeline:
   ```ts
   const { db } = createTestDb();
   wireBusToTestDb(db);
   await drivePipeline({
     promptId: 'prm_my_scenario',
     promptBody: 'add ...',
     // override stages, judge, retries as needed
   }, db);
   ```
4. Assert the structural invariants — events fired, stories in
   expected states, blockers filed, lineage shape.
5. Always assert the FULL lineage at end state:
   ```ts
   const journey = getPromptJourney(db, 'prm_my_scenario');
   expect(journey).toBeTruthy();
   expect(journey!.descendants.stories).toBeGreaterThan(0);
   ```

## Adding a new per-agent regression case

1. Open the right `agents/<name>.regression.test.ts` file.
2. Add a new `it(...)` block to the existing `describe(...)`.
3. Prefer **structural invariants** over exact-match assertions
   — agent outputs are partly LLM-driven (in production), so assert
   shape, presence, and counts, not specific text.
4. For LLM-judged steps (validator, test-design's optional LLM
   augmentation), inject a deterministic stub via the helpers'
   `makeAlwaysPassJudge` / `makeAlwaysFailJudge` /
   `makeRecoveringJudge`. Never rely on a running Ollama or Claude
   API in regression tests.

## Interpreting failures

When the regression suite fails:

1. **Read the failed assertion.** Almost always the message is
   self-explanatory ("required pipeline stage X not reached", "story
   stuck in_progress", "fix_loop_escalated payload missing case Y").
2. **Run the failing test in isolation:**
   ```bash
   cd apps/orchestrator && npx jest --testPathPattern <file> -t "<test-name>"
   ```
3. **Check the event stream.** The test DB is in-memory but every
   event is captured. Add a quick console.log:
   ```ts
   console.log(db.select().from(events).all().map(e => e.type));
   ```
   to see what fired vs what should have fired.
4. **Check the pipeline-stages table.** A missing stage means the
   driver short-circuited or an upstream agent crashed:
   ```ts
   console.log(db.select().from(promptPipelineStages).all().map(s => s.stage));
   ```
5. **Check stories.** `templateValidationStatus`, `validationStatus`,
   `testDesignStatus`, `bucketId` are the four columns that drive
   most regression assertions.

## Debugging the regression suite locally

The suite uses `:memory:` SQLite — there's nothing to clean up
between runs. If a test hangs, it's almost always the validator's
local-llm-router fall-through (Claude → Ollama) — make sure your
test injects a `JudgeAdapter` via the validator-loop options.

For the Coding Agent + Fix-It tests, no real subprocess runs — the
ImplementationEngine uses `MockLlmAdapter` and the FixItOrchestrator
uses the stub ports. If you see a real `npx jest` invocation hanging
inside the engine, you've forgotten to enqueue a turn on the mock
adapter.

## CI integration

The `Pipeline regression` GitHub Actions workflow
(`.github/workflows/pipeline-regression.yml`) runs both jobs in
parallel on every PR that touches:

- `apps/orchestrator/**`
- `apps/worker-coding/**`
- `apps/worker-fix-it/**`
- `packages/ticket-template/**`
- `packages/agent-contract-registry/**`
- `packages/architecture-registry/**`
- `packages/feature-registry/**`
- any test file under `apps/orchestrator/tests/e2e/**`

A failing job blocks the merge.

## DoD addition

Per `feedback_definition_of_done.md`, item 13:

> **Pipeline regression suite passes** (CI green) for any change
> touching agent behavior or pipeline glue.

Reviewers should verify both the unit test of the change AND the
regression suite green before approving.

## Further reading

- `docs/phase2-pipeline.md` — the operator runbook.
- `docs/agent-contracts.md` — the contract registry pattern.
- `docs/architecture-registry.md` — the AKG.
- `docs/story-validation.md` — the validator's 6-step rubric.

# @caia/reuse-check-gate

Enforcement layer **L2** of the reuse-first guardrail wave (see [ADR-065](https://github.com/prakashgbid/caia-ea/blob/main/decisions/ADR-065-reuse-first-as-enforced-discipline.md), AGENTS.md > Reuse-first).

## Why this package exists

`@caia/ea-architect.submitPlan` is published from a separate repo, so we cannot add a `reuseSearchResults` field to its schema directly. This adapter layers the field requirement on top of every CAIA-internal caller — plans of type `implementation` that omit the field, ship it empty, or ship malformed entries are refused before they reach the critic.

## Usage

```ts
import { submitPlanWithReuseGate, type PlanWithReuse } from "@caia/reuse-check-gate";
import { EaArchitectAgent } from "@caia/ea-architect";

const ea = new EaArchitectAgent({ /* ... */ });

const plan: PlanWithReuse = {
  planMarkdown: "## Plan\n\nBuild the wizard step 5.",
  planType: "implementation",
  callerAgentId: "agent:dispatch-orchestrator",
  submittedBy: "operator",
  reuseSearchResults: [
    { packageName: "@caia/ui", considered: true, decision: "selected", reason: "Card + Button + Progress all present" },
    { packageName: "@chiefaia/http-client", considered: true, decision: "rejected", reason: "no HTTP in this story" },
  ],
};

await submitPlanWithReuseGate(plan, ea);
```

If `reuseSearchResults` is missing, empty, or malformed for an `implementation` plan, `ReuseSearchGateError` is thrown and `ea.submitPlan` is never called.

## API

| Export | Purpose |
|--------|---------|
| `submitPlanWithReuseGate(plan, ea)` | Asserts the gate then delegates to `ea.submitPlan`. |
| `assertReuseSearchPresent(plan)` | Throws `ReuseSearchGateError` if the plan fails the gate. Use directly when you want to validate without submitting. |
| `hasSelectedReusePackage(plan)` | Did the planner actually select ≥ 1 workspace package for reuse? |
| `ReuseSearchGateError` | Error class with `code`, `planType`, `submissionId` fields. |
| `PlanWithReuse`, `ReuseSearchResult`, `PlanType` | Types. |

## Plan types and gate behaviour

| Plan type | Gate enforced? |
|-----------|----------------|
| `implementation` | **Yes** — `reuseSearchResults` must be present and non-empty |
| `research` | No (recommended) |
| `spec` | No (recommended) |
| `architecture-change` | No (recommended) |
| `process-change` | No (recommended) |

Implementation plans ship code, so they're the only type where the reuse-first rule has bite. The other plan types may still include `reuseSearchResults` voluntarily and the gate accepts whatever is there without complaint.

## Tests

```
pnpm --filter @caia/reuse-check-gate test
```

22 vitest cases covering: happy paths for each plan type, refusals for missing / empty / malformed fields, error-shape assertions, delegation behaviour, and the `hasSelectedReusePackage` query helper.

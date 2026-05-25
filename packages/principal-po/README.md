# @caia/principal-po

**Thin facade re-export package.** No new logic — every export delegates to one of three subordinate packages.

## Why this exists

Memory (`agent-memory/project_caia_canonical_pipeline_2026-05-22.md`) names a single **"Principal PO"** role at Step 6 of the canonical pipeline. On disk that role is split across three packages because the concerns are independently testable. This facade exists to keep the name memory uses pointable from real code, without forcing callers to know about the split.

Operator decision (2026-05-25): **keep memory's name; ship a thin facade re-export package.**

## What it re-exports

| Canonical name (memory) | Underlying export | Lives in |
| --- | --- | --- |
| `decomposeStoryHierarchy` | thin wrapper over `new PORecursiveDecomposer().decomposeRoot()` | `@chiefaia/decomposer-recursive` |
| `PORecursiveDecomposer` (class) | direct re-export | `@chiefaia/decomposer-recursive` |
| `scheduleStoryGraph` | direct re-export of `schedule` (aliased) | `@caia/principal-engineer` |
| `ArchitectRegistry`, `BaseArchitect`, `computeWaves`, `computeWavesFromMeta` | direct re-exports | `@caia/architect-kit` |
| Common types — `ArchitectInput`, `ArchitectOutput`, `ArchitectName`, `ArchitectMeta`, `RenderableDesign`, `TenantContext`, `Wave`, `Ticket` (aliased to `ArchitectTicket`), `ScheduleInput`, `ScheduleResult`, `SchedulerConfig`, `TicketGraph`, `WaveBucket`, `WavePlan`, `DecomposeOneOptions`, `DecomposeRootOptions`, `DecomposeRootResult`, `DecomposedTreeNode`, `ParentNode` | direct re-exports | per source package |

## Usage

```ts
import {
  decomposeStoryHierarchy,
  scheduleStoryGraph,
  ArchitectRegistry,
  BaseArchitect,
  computeWaves,
} from '@caia/principal-po';
```

That's the entire public surface. No additional logic; no new package state.

## What this package is NOT

- **NOT a re-implementation.** Every export delegates to a subordinate package. Updates to the subordinate packages flow through transparently.
- **NOT an umbrella owner.** The three subordinate packages remain independently owned, independently tested, independently versioned. This facade does not absorb them.
- **NOT a new architectural layer.** It is naming alignment between memory's vocabulary and the on-disk package split.

## Underlying-package map

- **`@chiefaia/decomposer-recursive`** (note the `@chiefaia` scope — known naming drift; not resolved by this facade) — recursive PO decomposition engine, scope detector, atomicity classifier, MECE judge pair.
- **`@caia/principal-engineer`** — Stage-12 scheduler. Takes EA-approved + Test-Author-prepared tickets and dispatches Full-Stack-Engineer workers across waves bucketed from a dependency graph.
- **`@caia/architect-kit`** — `SpecialistArchitect` interface, `BaseArchitect` abstract class, shared types (`ArchitectInput/Output`, `Ticket`, `BusinessPlan`, `RenderableDesign`, `TenantContext`), precedence ladder, `ArchitectRegistry` + dependency-graph helpers.

## Tests

`tests/index.test.ts` contains smoke tests that assert the re-exports resolve. They deliberately do NOT duplicate the subordinate packages' own test suites — each subordinate package owns its functional tests.

## References

- `agent-memory/project_caia_canonical_pipeline_2026-05-22.md` — canonical-pipeline doc that names "Principal PO" at Step 6
- `packages/principal-engineer/PLAN.md` — Stage-12 scheduler plan (PR #577)
- `packages/decomposer-recursive/src/index.ts` — decomposer-recursive public surface
- `packages/architect-kit/src/index.ts` — architect-kit public surface

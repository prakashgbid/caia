# @caia/time-machine-architect

Architect #14 of CAIA's 17-architect EA fan-out. Owns durable rollback + commit-level time-travel.

## What it owns

`timeMachine.*` slice of the `tickets.architecture` JSONB column:

- `timeMachine.versioningStrategy` — every commit captured + described; how the version chain is materialized + addressed (snapshot key shape, commit graph, immutability posture)
- `timeMachine.snapshotRetention` — how long versions are kept, archival rules, GDPR delete interaction
- `timeMachine.revertOperation` — **forward-creating** revert (new commit on tip, never destructive overwrite); revert scope (whole feature vs section); idempotency contract
- `timeMachine.descriptionGeneration` — auto-generated per-commit human-readable summary (style guide, length budget, regeneration policy)
- `timeMachine.dataConsistency` — revert respects DB state vs application state; transactional posture; cascade rules across upstream Database `dataLifecycle`
- `timeMachine.auditTrail` — every revert logged + attributed to operator action (who, when, from→to, scope, reason)

## What it does NOT do

No component code. No API endpoint logic. No database schema. No test specs. Other architects own those concerns; the contract rejects out-of-namespace writes.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1, §2.14). Wave-2 architect: depends on Backend Architect + Database Architect (especially Database's `dataLifecycle` + GDPR delete patterns) so it knows what state needs versioning and how revert interacts with retention.

The EA Dispatcher spawns one Time Machine architect per applicable ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

**The forward-creating revert invariant.** A revert is itself a commit — appended to the version chain, never an in-place overwrite of history. This is what makes time-travel safe: an operator can revert the revert, walk back to any intermediate state, and the audit trail always shows what happened. The package's golden test pins this invariant.

## Quick start

```ts
import { TimeMachineArchitect } from '@caia/time-machine-architect';

const architect = new TimeMachineArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { backend: backendOutput, database: databaseOutput } },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, cross-architect invariants, and an end-to-end golden test that verifies the forward-creating revert invariant — every revert produces a new snapshot at the chain tip, never overwrites a prior version.

## Reference

Generalizes the snapshot/revert pattern proven in `@caia/atlas-design-snapshotter` (PR #538) from designs to ALL versionable state — not just the design IR, but feature behavior, configuration, data shape, anything a ticket's lifecycle introduces.

# @caia/ux-version-control-architect

Architect #15 of CAIA's 17-architect EA fan-out. Owns durable UX-asset version control + design-revert UX.

## What it owns

`uxVersionControl.*` slice of the `tickets.architecture` JSONB column:

- `uxVersionControl.designVersionRetention` — how many design uploads are kept, archival rules, GDPR delete interaction
- `uxVersionControl.revertOperation` — **forward-creating** revert (new design version appended on the chain tip, never destructive overwrite); revert scope (whole design vs section); idempotency contract
- `uxVersionControl.diffVisualizationSpec` — what the diff between v1 and v2 of a UX upload looks like (anchors added/modified/removed; token deltas; copy deltas; surface rendering channel)
- `uxVersionControl.branchingStrategy` — whether a customer can fork a design version; merge / abandon / promote semantics
- `uxVersionControl.auditTrail` — every UX upload + revert logged + attributed to operator action (who, when, from→to, scope, reason)

## What it does NOT do

No component code. No API endpoint logic. No database schema. No test specs. Code-level versioning (commits, deploys, rollbacks) is the Time Machine Architect's (#14) concern. Other architects own those concerns; the contract rejects out-of-namespace writes.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1, §2.15). Wave-1 architect with no upstream dependencies: reads `designVersion` directly from input.

The EA Dispatcher spawns one UX Version Control architect per applicable ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

**The forward-creating revert invariant.** A revert is itself a new design version — appended to the design-version chain, never an in-place overwrite of history. This is what makes design time-travel safe: an operator can revert the revert, walk back to any uploaded UX, and the audit trail always shows what happened. The package's golden test pins this invariant.

**Distinct from Time Machine.** Time Machine (#14) owns CODE-level versioning — commits, deploys, rollbacks. This architect owns DESIGN-level versioning — design uploads, design diffs, design reverts. The two contracts are disjoint by construction; the JSONB namespaces (`timeMachine.*` vs `uxVersionControl.*`) never collide.

## Quick start

```ts
import { UxVersionControlArchitect } from '@caia/ux-version-control-architect';

const architect = new UxVersionControlArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: {} },
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

The suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, cross-architect invariants, and an end-to-end golden test that verifies the forward-creating revert invariant — every revert produces a new design version at the chain tip, never overwrites a prior version.

## Reference

Generalizes the snapshot/revert pattern proven in `@caia/atlas-design-snapshotter` (PR #538) — `captureSnapshot()` + `revertToVersion()` already demonstrate the immutable / append-only / forward-creating contract for a single uploader. This architect specifies that contract at the per-ticket architecture level so every UX-bearing ticket inherits the same guarantee.

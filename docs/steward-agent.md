# DevOps Steward Agent

A continuous-compliance daemon that observes git/CI/release/deploy/secret/daemon
events across the CAIA monorepo, codifies expected lifecycles as a YAML process
graph, and flags drift when the system diverges from policy.

**Status:** P0 — `@chiefaia/steward-core` package shipped (propose-only). Daemon
(P1) and risk-tiered actor (P5) are queued; see
`~/Documents/projects/reports/steward-agent-pr-queue-2026-05-03.md`.

**Why it exists:** the 2026-04-30 → 2026-05-03 back-merge incident exposed a
fourth-shape gap in the codebase's enforcement layers. Evidence Gate, branch
protection, and Husky are *pre-action gates*. caia-flow CLI is a *synchronous
verb*. Memory rules are *static documents*. None are *continuous post-action
observers*. The Steward fills this fourth shape.

**Reference design:**
`~/Documents/projects/reports/devops-steward-agent-design-2026-05-03.md`
(~16,500 words; full architecture, sequenced PR plan, risk tiering,
self-upgrade design, no-blocker analysis).

## What's in P0 (this PR)

```
packages/steward-core/
├── package.json              # @chiefaia/steward-core@0.1.0
├── src/
│   ├── index.ts              # public exports
│   ├── events.ts             # StewardEvent shape
│   ├── process-graph.ts      # Zod schema for YAML process definitions
│   ├── load-process-graph.ts # YAML loader + validator
│   ├── predicate.ts          # minimal predicate evaluator (no deps)
│   └── evaluate.ts           # single-process evaluator → ProcessDrift[]
├── processes/
│   └── post-release-back-merge.yaml  # the rule that ships
└── tests/                    # 54 cases (predicate + schema + adversarial)
```

Plus migration `0053_steward_events.sql` (new tables `steward_events` and
`steward_process_state`) and a small extension to
`apps/smart-cicd-agent/src/types.ts` adding two `steward_*` bucket names so
the Steward can write drift observations to the existing
`smart_cicd_observations` table without schema changes.

## The codified process

`packages/steward-core/processes/post-release-back-merge.yaml` declares:

- Two transitions:
  1. `release_landed → back_merge_opened` within **30 minutes**, severity
     `medium`, recovery `open-back-merge-pr`.
  2. `back_merge_opened → back_merge_merged` within **4 hours**, severity
     `high`, recovery `alert-operator`.
- Three invariants that derive Steward events from raw GitHub PR events.

Adding a new process is a single YAML file in `processes/`; no code change
required. The schema is validated at load time.

## Public API

```typescript
import {
  loadProcessGraph,
  evaluateProcess,
  type Process,
  type StewardEvent,
  type ProcessDrift,
} from '@chiefaia/steward-core';

const { processes, errors } = await loadProcessGraph('./processes');
if (errors.length) console.warn('invalid YAMLs:', errors);

const drifts = evaluateProcess(processes[0], events, { now: Date.now() });
for (const drift of drifts) {
  // Write to smart_cicd_observations with bucketName matching the drift type.
  // (This wiring lives in P1 — apps/steward-agent/src/cycle.ts.)
}
```

## Authority and propose-only invariant

The `@chiefaia/steward-core` package is **inert** until P1 wires it into a
running daemon. P0 ships only the package, the YAML, the migration, and the
tests. Even when P1 lands, the Steward writes observation rows but does NOT:

- Open PRs
- Push or force-push
- Merge or close PRs
- Modify `.github/workflows/*`
- Touch the Capability Broker registry
- Write to Vault

Auto-execution of safe Tier 1 actions begins in P5, gated through the
Capability Broker with a 5-second delay window for medium-tier actions.

## Tests + DoD

```bash
pnpm --filter @chiefaia/steward-core typecheck   # green
pnpm --filter @chiefaia/steward-core lint        # green
pnpm --filter @chiefaia/steward-core test        # 54 cases green
pnpm --filter @chiefaia/steward-core build       # green
pnpm --filter @caia-app/smart-cicd-agent typecheck  # green (BucketName extension)
```

DoD per `feedback_definition_of_done.md` (15 points). Adversarial-injection
corpus regression-suite green: 5 positive + 5 negative + 5 adversarial cases.

## Sequenced next PRs

| PR | Title | Hours |
|----|-------|-------|
| P1 | `@caia-app/steward-agent` daemon — GitHub poller wired to steward-core | 2-3 |
| P2 | `/operations/steward` dashboard widget + `pnpm steward {status,stats}` | 2-3 |
| P3 | worktree-hygiene + daemon-health process YAMLs + FS poller | 2-3 |
| P4 | dependency-upgrade + security-incident process YAMLs | 2-3 |
| P5 | actor module — Tier 1 auto-execute via Capability Broker | 3-4 |
| P6 | Tier 2 actor — 5s delay execute with dashboard veto | 2-3 |
| P7 | self-upgrade loop — daily metrics + weekly meta-drift PRs | 3-4 |
| P8 | process-upgrader — weekly web scan + candidate PRs | 3-4 |

Spawn-ready prompts for each are in
`~/Documents/projects/reports/steward-agent-pr-queue-2026-05-03.md`.

# `@caia/lifecycle-conductor`

**Real-DoD Layer 4 — composite solution-lifecycle aggregator.**

Subscribes to attestation events from the five stewards (`deploy`, `usage`, `activation`,
`outcome`, `future-incoming`) and computes a per-solution composite state via the
`@caia/state-machine` solution-lifecycle FSM.

A solution is **DONE** iff:

1. all five stewards' most-recent attestations are `green`, AND
2. all five attestations are within their per-steward freshness window, AND
3. the composite state has been `producing-metrics` for ≥24 consecutive hours, AND
4. no `degraded` transition fired during that holdover window.

This package owns the *composite* "is this solution truly done" decision. Each individual
steward owns one verification surface and emits green/red on its own data; none of them
owns the cross-cutting AND.

## Composite state model

Forward chain (lifecycle-conductor's canonical-doc vocabulary; the gate ordinal in parens):

| State                        | Ordinal | Requires                              |
| ---------------------------- | :-----: | ------------------------------------- |
| `plan-approved`              |    0    | (initial)                             |
| `pr-merged`                  |    1    | any attestation observed              |
| `deployed`                   |    3    | `deploy` green+fresh                  |
| `built-into-active-app`      |    5    | `deploy` + `usage` green+fresh        |
| `called-in-test`             |    7    | + `activation` green+fresh            |
| `producing-metrics`          |    9    | + `outcome` AND `future-incoming`     |

Plus orthogonal sticky states:

- `degraded` — entered on any red; clears only after `consecutiveGreensAcrossAllStewards
  >= degradedClearThreshold` (default 3).
- `sunset` — terminal, operator-driven.

## Public surface

```ts
import {
  LifecycleAggregator,        // subscribes to attestation events; drives the FSM
  LifecycleConductorApi,      // getSolutionLifecycle / listIncompleteSolutions / getDodStatus
  projectToSse,               // SSE projection helper (server-side)
  reportToInbox,              // INBOX surfacer
  DefaultFsmDriver,           // pure evaluate + decide
  STEWARD_GATE_ORDINAL,
  DEFAULT_FRESHNESS_HOURS,
  type StewardName,
  type StewardAttestation,
  type CompositeState,
} from '@caia/lifecycle-conductor';
```

## Daemon

```sh
node packages/lifecycle-conductor/bin/lifecycle-conductor-daemon
```

A `launchd` plist is shipped at `launchd/com.caia.lifecycle-conductor.plist` (`KeepAlive`
true; `RunAtLoad` true). The daemon is a continuous listener — no polling.

## Spec

Implements `research/real_definition_of_done_enforcement_2026.md` §4.4 + §6 + Task A9.

## Reused

- `@caia/state-machine` — `SolutionLifecycleMachine`, `InMemorySolutionStore`,
  `SseConnection`, `handleProjectSse` (pattern), `SOLUTION_STATE_CANONICAL_SYNONYM`.
- `@caia/pipeline-conductor` — SSE projector daemon shape.
- Five stewards — subscription-only.

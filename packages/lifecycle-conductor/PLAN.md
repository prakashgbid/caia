# Plan — `@caia/lifecycle-conductor` — restore spec §4.4 4-steward boundary

**Plan type**: `refactor`
**Caller**: `claude-agent-mode/cowork`
**Submitter**: operator (Stolution)
**Affected components**: `@caia/lifecycle-conductor` (existing, PR #580), `caia-ea/decisions/ADR-063` (new)
**Branch**: `feature/lifecycle-conductor-restore-spec-4-stewards-2026-05-25`

## Brief

PR #580 shipped `@caia/lifecycle-conductor` with a 5-steward aggregator
(`deploy + usage + activation + outcome + future-incoming`). The Real-DoD
spec at `research/real_definition_of_done_enforcement_2026.md` §4.4 names a
different 5-gate composition: **4 stewards (deploy + usage + activation +
outcome) + the EA Agent's `ea-review-approved` state**. The shipped 5th
member (`future-incoming-steward`) is not in the spec and was never
implemented as its own package; the spec's actual 5th gate
(`ea-review-approved`) was never integrated.

This refactor closes that drift by:

1. Removing `future-incoming` from `STEWARD_NAMES`, gate ordinals,
   freshness defaults, and accumulator rows — restoring the strict
   4-steward boundary the spec requires.
2. Integrating `ea-review-approved` as the 5th DoD gate via a separate
   subscription path (`AggregatorEaReviewSource` envelope), with its own
   `eaReviewApproved` field on `SolutionAccumulator` and `DodStatus`.
3. Documenting the boundary as ADR-063 so future stewards can't silently
   slip back into the composite-DoD aggregator without an ADR.

`@caia/pipeline-conductor` (PR #570) already publishes its own
`## DRIFT ALERTS` envelope independently and is **not** part of this
refactor — it never had a subscription path into lifecycle-conductor;
gap-analysis caveat #9's "drift sentinel" guess was incorrect.

## Scope (subscription-only; no schema changes downstream)

In-package only. No changes to:
- `@caia/state-machine` (FSM remains the operator-vocab walker)
- `@caia/pipeline-conductor` (drift-detector + alerter untouched)
- `@chiefaia/event-bus-internal` (envelope shape is additive — new
  envelope kind, no breakage to existing steward attestations)

## Public surface delta

```diff
- export const STEWARD_NAMES = ['deploy','usage','activation','outcome','future-incoming']
+ export const STEWARD_NAMES = ['deploy','usage','activation','outcome']

+ export interface EaReviewState {
+   solutionId: string;
+   approved: boolean;
+   at: string;  // ISO
+   reviewer?: string;
+ }
+ export function coerceEaReviewState(payload: unknown): EaReviewState | null

  export class LifecycleAggregator {
+   ingestEaReview(state: EaReviewState): void
+   setEaReviewApproved(solutionId: string, approved: boolean, at?: string): void
  }

  export interface LifecycleAggregatorOptions {
+   /** Separate event sources that emit ea-review envelopes. */
+   eaReviewSources?: AttestationEventSource[]
  }

  export interface DodStatus {
+   eaReviewApproved: boolean
  }
```

`DodStatus.done` now requires: `compositeState === 'producing-metrics'
AND holdoverHoursRemaining === 0 AND !driftDuringHoldover AND
eaReviewApproved AND no stewards missing/red/stale`.

## Pipeline (what changes at runtime)

1. The aggregator's 4 steward subscriptions still drive the forward chain;
   `producing-metrics` is now reachable with `deploy + usage + activation +
   outcome` all green+fresh (no longer blocked by absent
   `future-incoming`).
2. A new orthogonal channel ingests `EaReviewState` envelopes. Approval
   sets `acc.eaReviewApproved = { approved: true, at }` and is checked
   by `computeDod`.
3. Any incoming attestation whose `steward` field is `future-incoming` (or
   any other non-STEWARD_NAMES value) is dropped by the existing
   `coerceAttestation` type-guard. A new explicit unit test asserts this.

## ADR

`caia-ea/decisions/ADR-063-lifecycle-conductor-four-steward-strict.md`
documents:
- The 4-steward boundary (deploy + usage + activation + outcome)
- The orthogonal `ea-review-approved` 5th gate
- The distinction between Real-DoD ("is this thing producing intended
  results") and Continuous Discipline L5 / drift-sentinel ("has
  architecture drifted from ADRs") — different gates, different alerts,
  different runbooks
- Citation: spec §4.4, gap-analysis caveat #9, ADR-062 sequence

## Tests

Existing 81 tests adjusted for 4-steward shape; new tests:
- `STEWARD_NAMES` contains exactly 4 entries.
- `future-incoming` attestations are dropped by `coerceAttestation`.
- Aggregator ignores envelopes shaped like the
  `## DRIFT ALERTS` (`policy.violation.detected`, etc.) — explicit
  guard that pipeline-conductor's drift signals never leak into the
  composite DoD.
- `eaReviewApproved` gates `DodStatus.done`.
- `ingestEaReview` / `setEaReviewApproved` round-trip.

## DoD

Tests + typecheck green; PR opened; CI green; admin-squash-merge per
True-Zero carve-out (PR #587 + #592 ratified). Commit subject MUST
carry `[True-Zero admin-merge]` — passed via `gh pr merge --subject`
to dodge the PR #592 gotcha.

## Risks

- **Downstream snapshot consumers** that destructure `rows['future-incoming']`
  break. Mitigation: in-package grep finds zero such consumers — the
  field was only ever exposed via `SolutionLifecycleView.rows` and the
  aggregator's own clones, all of which are updated atomically here.
- **EA Agent isn't yet emitting `ea-review-approved` envelopes** —
  `eaReviewApproved` defaults to `null` (treated as not-yet-approved),
  so `DodStatus.done` returns `false` until the EA Agent wires up the
  emission. This is the desired conservative default. A follow-up
  task tracks EA Agent integration.
- **No `ea-review-approved` blocks `producing-metrics` transition?** No
  — the forward chain still reaches `producing-metrics` on the 4
  steward greens. Approval gates DoD = true, not the FSM walk. This
  matches the spec's separation of "verifiable outcomes" (stewards)
  from "human-attested approval" (EA Agent).

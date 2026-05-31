# `apps/wizard` + `@chiefaia/events-taxonomy-internal` — NATS lifecycle events for every wizard FSM transition (WIZARD-B5)

**Author:** autonomous-build (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/wizard-b5-nats-fsm-events-2026-05-31`
**True-Zero admin-merge:** RATIFIED (subscription-only Claude Max; `.caia/build-phase-active` carve-out continues to apply).

## 1. Why this exists

Phase B Task B5 of the CAIA wizard pipeline: every `@caia/state-machine`
`StateMachine.transition()` dispatched from `apps/wizard` must publish three
NATS lifecycle events so downstream consumers (Pipeline Conductor, Dashboard,
Drift Sentinel) can react in real time:

- `wizard.step.transitioning` — fired immediately *before* the FSM call.
- `wizard.step.completed` — fired *after* the FSM call resolves OK.
- `wizard.step.failed` — fired *if* the FSM call throws.

The PR adds the three events to the canonical taxonomy, wires a single
fire-and-forget publisher wrapper (`withFsmPublish`) around every FSM
dispatch the wizard makes, and ships 23 vitest cases covering the contract.

## 2. Scope of this PR

### 2.1 In scope

1. **`packages/events-taxonomy-internal/registry.yaml`** — three new event
   definitions (`wizard.step.transitioning`, `wizard.step.completed`,
   `wizard.step.failed`) following the existing `pipeline.started` shape.
2. **`packages/events-taxonomy-internal/index.ts`** — types added to the
   `EventType` union, `EVENT_SEVERITY` map (info / info / error), and three
   payload interfaces (`WizardStepTransitioningPayload`,
   `WizardStepCompletedPayload`, `WizardStepFailedPayload`).
3. **`apps/wizard/lib/wizard/fsm-events.ts`** — new module exporting
   `withFsmPublish(opts, fn)`, `publishStepTransitioning`,
   `publishStepCompleted`, `publishStepFailed`, and `currentTraceId()`.
   Pure functions; no Next.js or NATS imports beyond the structural
   `FsmEventPublisher` interface that `@chiefaia/event-bus-nats`'s
   `HybridEventBus` already satisfies.
4. **`apps/wizard/lib/tenants/wire.ts`** — exposes the existing lazy
   publisher singleton via a new public `getFsmPublisher()`. Re-uses the
   same `HybridEventBus` instance that already publishes `tenant.provisioned`.
5. **`apps/wizard/app/api/wizard/[projectId]/state/route.ts`** — wraps the
   PATCH route's `sm.transition()` call with `withFsmPublish(...)`.
6. **`apps/wizard/app/api/wizard/interview/complete/route.ts`** — wraps the
   POST route's `sm.transition()` call with `withFsmPublish(...)`.
7. **Tests** — `tests/wizard-shell/fsm-events.test.ts` (23 cases). Existing
   `tests/wizard-shell/wizard-steps/interview-complete-route.test.ts` (10
   cases) extended with mocks for the new `wire.ts` exports.

### 2.2 Out of scope

- Persisting the events to the per-tenant `state_transitions` history table
  (handled by `@caia/state-machine`'s store layer).
- The Pipeline Conductor / Dashboard subscriber implementations (the bus
  delivers events at-least-once; consumers land in sibling PRs).
- Wire-up of `wizard.step.*` to NATS via the
  `BUS_BACKEND_NATS_FOR_EVENT_TYPES` env flag (operator decision; the
  `HybridEventBus` defaults to the legacy in-process bus, so this PR is
  safe to merge with flag off).

## 3. Reuse-first compliance

| Dep | Use | Decision |
| --- | --- | --- |
| `@chiefaia/event-bus-nats` | Publisher surface | **selected** — `HybridEventBus.publish()` satisfies the structural `FsmEventPublisher` interface. No raw `nats.connect()` is opened from the wizard. |
| `@chiefaia/events-taxonomy-internal` | Event taxonomy | **selected** — three new event types + payload interfaces added to the registry's TS surface. `isValidEventType` rejects strings outside the union. |
| `@caia/state-machine` | FSM transition surface | **selected** — `StateMachine.transition()` is the only call the wrapper guards. The wrapper does NOT touch the SM's internals; it adds a publish ring around the call. |
| `@chiefaia/tracing` | Trace-id propagation | **selected (transitive via `@opentelemetry/api`)** — `currentTraceId()` reads the active span via `trace.getActiveSpan().spanContext().traceId`. Returns `null` when no SDK is initialised. |
| `@caia/secrets-adapter` | (not used) | **rejected** — the publisher is constructed from env in `lib/tenants/wire.ts`; the secrets adapter is reserved for Infisical lookups. |
| `@caia/ui` | (not used) | **rejected** — server-side surface; no UI primitives needed. |

No raw `nats` client, no parallel FSM, no new bus backend.

## 4. Test strategy

| Layer | File | Cases |
| --- | --- | --- |
| Taxonomy / registry.yaml shape | `tests/wizard-shell/fsm-events.test.ts` | 3 |
| TS surface (EVENT_SEVERITY / ALL_EVENT_TYPES / isValidEventType) | same file | 2 |
| `withFsmPublish` wrapper contract | same file | 14 |
| `currentTraceId()` behavior | same file | 1 |
| `publishStep*` direct helpers | same file | 3 |
| **Total new** | | **23** |

All 23 new + 235 existing wizard tests pass. State-machine (211) and
event-bus-nats (135) package suites also pass.

## 5. Definition of Done

- [x] `registry.yaml` extended with the three `wizard.step.*` events.
- [x] `events-taxonomy-internal/index.ts` extended (union + severities + interfaces).
- [x] `apps/wizard/lib/wizard/fsm-events.ts` created.
- [x] `apps/wizard/lib/tenants/wire.ts` exposes `getFsmPublisher()`.
- [x] Both wizard `sm.transition()` call-sites wrapped with `withFsmPublish`.
- [x] 23 new vitest cases pass.
- [x] All 235 wizard unit tests pass.
- [ ] PR merged via True-Zero admin-merge squash.

# `apps/wizard` — atlas-UI SSE route (C5)

**Author:** autonomous-build (operator-dispatched 2026-05-30)
**Status:** Implementation complete
**ADR refs:** ADR-065 (reuse-first as enforced discipline)
**Branch:** `feature/c5-atlas-sse-2026-05-30`
**True-Zero admin-merge:** RATIFIED — subscription-only Claude Max; pre-existing TS2352 + lighthouse-CI fails from the PR #625 era are tolerated per the operator standing instruction.

## 1. Why this exists

PR #545 shipped `@caia/atlas-ui` with the wire contract for an SSE event stream — `AtlasApiClient.subscribeEvents(projectId, onEvent, onError)` opens an `EventSource` against `/api/atlas/project/${projectId}/events` and parses `JSON.parse(e.data)` as `AtlasSseEvent`. The client side, including the `useAtlasSse` React hook, was complete.

What was missing — and what the original C5 brief mistakenly characterised as "polling" — was the *server* end of that contract. The wizard's atlas page (`AtlasWizardClient`) was wired to `createMockClient(fixtures)` only; no live route existed at `/api/atlas/project/[projectId]/events`. There was nothing to subscribe to.

This PR delivers the missing server half and swaps the wizard's atlas page over to it.

## 2. Scope of this PR

### 2.1 In scope

1. **`apps/wizard/lib/atlas/sse.ts`** — pure adapter module: `adaptConductorToWire`, `serialiseSseFrame`, `serialiseKeepaliveComment`, `subscribeAtlasEvents`. Reused by both the route handler and unit tests.
2. **`apps/wizard/app/api/atlas/project/[projectId]/events/route.ts`** — Next.js App-Router streaming `GET` handler. Subscribes to `@chiefaia/event-bus-internal` for the three `atlas.*` event types, filters by `project_slug`, and pipes wire frames onto a `ReadableStream`.
   - *Path note:* the C5 brief said `apps/wizard/app/api/atlas/[projectId]/events/route.ts`. The PR-#545 client already calls `/api/atlas/project/:id/events` (note the `project/` segment), so the route segments must include `project/` to honour the existing wire contract. This is a path-string adjustment, not a scope change.
3. **`apps/wizard/app/api/atlas/__test/publish/route.ts`** — test-only `POST` that publishes a synthetic event onto the in-process bus. Gated by `ATLAS_SSE_TEST_PUBLISH=1`; returns 404 otherwise. Exists for the Playwright E2E.
4. **`packages/events-taxonomy-internal/`** — register `atlas.element.highlighted`, `atlas.prompt.completed`, `atlas.version.changed`:
   - `registry.yaml` — full type/severity/actor/payload entries with publisher/subscriber commentary.
   - `index.ts` — extend `EventType`, `EVENT_SEVERITY`, and add three `AtlasXxxPayload` interfaces.
5. **`packages/atlas-ui/src/types/index.ts`** — extend the `AtlasSseEvent` discriminated union with `AtlasElementHighlightedEvent`, `AtlasPromptCompletedEvent`, `AtlasVersionChangedEvent`. Existing variants stay intact (the V1 fixtures use them).
6. **`apps/wizard/components/wizard/AtlasWizardClient.tsx`** — hybrid client: mock fixtures for the fetch endpoints (no live atlas backend yet), `createHttpClient` for `subscribeEvents`. Wires `useAtlasSse` and renders an `data-testid="atlas-sse-status"` badge so the Playwright E2E can assert realtime delivery.
7. **Tests:**
   - `apps/wizard/tests/wizard-shell/atlas-sse.test.ts` — 17 vitest cases covering the adapter, the bus subscription, SSE-frame serialisation, and the route handler. ≥ the 10-case floor from the brief.
   - `apps/wizard/tests/wizard-shell/atlas-sse.spec.ts` — Playwright spec asserting the badge updates within 750ms of a server-side publish, plus a negative project-scope test.
8. **`apps/wizard/playwright.config.ts`** — webServer env adds `WIZARD_AUTH_MODE: 'disabled'` and `ATLAS_SSE_TEST_PUBLISH: '1'` so the Playwright run can drive the page without the strict-JWT middleware.

### 2.2 Out of scope (sibling work owns)

- The live `getLatestDesign` / `getTicketsTree` backend (Wave 3 atlas-orchestrator).
- Publishing the three `atlas.*` event types from actual workers — that's the next worker-side PR. Today the only publisher in-tree is the test-only `__test/publish` route.
- A `useAtlasEvents` rename of the existing `useAtlasSse` hook — explicitly skipped per the revised brief; renaming would churn the public API for no benefit.

## 3. Reuse-first compliance

| Candidate | Considered for | Decision | Reason |
| --- | --- | --- | --- |
| `@chiefaia/event-bus-internal` | bus subscription | **selected** | The route subscribes via `eventBus.subscribe(type, handler)` exactly as `lib/tenants/wire.ts` already does for tenant events. No new dependency. |
| `@chiefaia/events-taxonomy-internal` | event-type registration | **selected** | Three new entries in `registry.yaml` + the `EventType` union. Mirrors the WIZARD-B5 / WIZARD-B8 patterns. |
| `@caia/state-machine` (`handleProjectSse` / `SseConnection`) | SSE framing | **rejected — incompatible runtime** | The canonical helper takes `node:http` `IncomingMessage`/`ServerResponse`; the Next.js App Router uses `Response` + `ReadableStream`. We replicate the EventSource-spec wire format (governed by W3C, not by `@caia/state-machine`) in a pure-string helper so the framing remains identical without dragging the helper's `node:http` shape into a Web-API context. Documented in the file header. |
| `@caia/atlas-ui` | wire types + client + hook | **selected** | The PR-#545 client (`createHttpClient`) and hook (`useAtlasSse`) are reused as-is. The `AtlasSseEvent` union is *extended* (three new members) — additive, no removals. |
| `@caia/atlas-prompt-router` | prompt validation | **selected (already in use)** | The existing `/api/wizard/atlas/[projectId]/prompt` route uses `createAtlasPromptApiHandler`. Unchanged by this PR. |
| `@caia/ui` | UI primitives | **selected (already in use)** | The wizard atlas page wraps `AtlasWizardClient` in `Card`/`CardContent` from `@caia/ui`. The new badge is a plain `<div>` with `data-testid` — purely observable, not a UI primitive, so the reuse-first CI gate doesn't apply. |
| `picomatch` (via the bus) | event-type glob | **selected (already in use)** | `subscribeAtlasEvents` uses exact-type subscriptions; the underlying bus uses picomatch internally either way. |

## 4. Architecture — what the route delivers when a client subscribes

When `useAtlasSse` opens an `EventSource` against `/api/atlas/project/${projectId}/events`:

1. The route writes `: open\n\n` immediately so the EventSource `onopen` fires deterministically (some intermediaries buffer until the first byte).
2. It registers three exact-type subscriptions on `eventBus`: `atlas.element.highlighted`, `atlas.prompt.completed`, `atlas.version.changed`.
3. For each event published in-process, `adaptConductorToWire` checks `event.project_slug === projectId` and translates the snake-case envelope into the camel-case wire shape `useAtlasSse` is typed against. Unknown / cross-project / malformed-payload events drop on the floor (returns `null`).
4. The frame is `id: <ts>\nevent: message\ndata: <json>\n\n` — spec-compliant EventSource, identical framing to `@caia/state-machine`'s `SseConnection`.
5. Every 15s the route writes a `: keepalive\n\n` comment so reverse proxies don't idle-time-out the connection.
6. `req.signal.abort` (client `EventSource.close()` or network teardown) detaches all three bus subscriptions and clears the keepalive timer.

A sample wire excerpt for a single `atlas.prompt.completed` event:

```
: open

id: 2026-05-30T12:01:23.456Z
event: message
data: {"type":"atlas.prompt.completed","ticketId":"t-1","promptGroupId":"pg-1","result":"ok","versionId":"tv-1","ts":"2026-05-30T12:01:23.456Z"}

: keepalive

```

## 5. Test strategy

| Layer | File | Cases |
| --- | --- | --- |
| Adapter / framing (vitest) | `tests/wizard-shell/atlas-sse.test.ts` | 14 unit + 3 route-handler integration = **17** |
| Realtime UI proof (Playwright) | `tests/wizard-shell/atlas-sse.spec.ts` | 2 (happy path + project-scope negative) |

Adapter cases cover: happy-path mapping for each of the three types, `ts` fallback to `event.occurred_at`, missing-required-field returns null, scope mismatch returns null, non-atlas type returns null, invalid `result` value returns null, multi-event sequencing, unsubscribe stops delivery, frame-format invariants (id / event / blank-line terminator), keepalive-comment format, and exact-type subscription set (the `ATLAS_SSE_EVENT_TYPES` constant).

Route handler cases assert: 200 + `text/event-stream` + `no-cache`, the open-comment is the first chunk, a project-scoped publish lands as a `message` frame with the wire JSON, and an empty projectId 400s.

The Playwright spec encodes the realtime contract in the assertion itself — a 750ms timeout that no plausible polling design could satisfy. If a future regression reintroduces polling, the test will start to flake before it silently slows down.

## 6. Definition of Done

- [x] `lib/atlas/sse.ts` + `app/api/atlas/project/[projectId]/events/route.ts` created.
- [x] Three event types registered in `events-taxonomy-internal` (registry + EventType union + EVENT_SEVERITY + payload interfaces).
- [x] `AtlasSseEvent` union extended in `@caia/atlas-ui` (additive).
- [x] `AtlasWizardClient` hybrid client wired; `useAtlasSse` consumes the new route; `atlas-sse-status` badge renders.
- [x] 17 vitest cases pass.
- [x] Playwright spec passes locally (`pnpm --filter @caia-app/wizard test:e2e`).
- [ ] PR merged via True-Zero admin-merge squash.
- [ ] First real worker that publishes `atlas.prompt.completed` lands in a sibling PR.

## 7. Follow-up tasks

1. **Real publishers.** The taxonomy is now reserved; the next step is to wire the worker-side emits (atlas-prompt-router emits `atlas.prompt.completed`, atlas-design-snapshotter emits `atlas.version.changed`).
2. **Replay.** The route emits `id: <ts>` so `Last-Event-ID` reconnects can carry context, but no replay path is wired yet. Add `eventBus.replay({ projectSlug, since })` on connect when the DB outbox is wired into the wizard process.
3. **Multi-replica fan-out.** When the wizard scales past one replica, the in-process bus stops being sufficient. Switch the route's bus subscription to the `HybridEventBus` that `lib/tenants/wire.ts` already uses — same `subscribe(type, handler)` shape, NATS-backed.

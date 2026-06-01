/**
 * Pure server-side adapter for the atlas SSE route.
 *
 * The route file (`app/api/atlas/project/[projectId]/events/route.ts`)
 * is a Next.js App-Router boundary and can't be unit-tested in
 * isolation — so all of the genuinely interesting behaviour lives in
 * this file:
 *
 *   - `adaptConductorToWire` translates a `@chiefaia/event-bus-internal`
 *     `ConductorEvent` envelope into the wire-shape `AtlasSseEvent`
 *     that `@caia/atlas-ui`'s `useAtlasSse` is typed against.
 *   - `serialiseSseFrame` produces an EventSource-spec-compliant SSE
 *     frame — same framing the canonical `SseConnection` from
 *     `@caia/state-machine` writes, but pure-string so it lands in the
 *     Web Streams `ReadableStream` the App Router expects.
 *   - `subscribeAtlasEvents` wires the bus subscription, project-scope
 *     filtering, and the adapter together, returning an unsubscribe.
 *
 * The route's only job is to: open a `ReadableStream`, call
 * `subscribeAtlasEvents` with a controller-driven sink, and forward
 * abort signals.
 *
 * Why three discrete subscriptions and not a glob? Because the
 * taxonomy is closed (`atlas.*` would accidentally pick up any future
 * `atlas.foo.bar` events) and the brief is explicit about the three
 * types. If the taxonomy grows, this list grows with it — caught by
 * the strict event-type union in `@chiefaia/events-taxonomy-internal`.
 *
 * Reuse-first: this module reuses `eventBus` from
 * `@chiefaia/event-bus-internal` and the wire types from
 * `@caia/atlas-ui` (the `AtlasSseEvent` union). It does NOT duplicate
 * the SSE-framing helper from `@caia/state-machine` because that
 * helper is tied to `node:http` `ServerResponse`; the App Router uses
 * `Response` + `ReadableStream`. We replicate the wire format (which
 * is governed by the EventSource spec, not by `@caia/state-machine`).
 */

import type { ConductorEvent } from '@chiefaia/event-bus-internal';
import { eventBus } from '@chiefaia/event-bus-internal';
import type { AtlasSseEvent } from '@caia/atlas-ui';

/** The three event types the atlas SSE route forwards. */
export const ATLAS_SSE_EVENT_TYPES = [
  'atlas.element.highlighted',
  'atlas.prompt.completed',
  'atlas.version.changed',
] as const;

export type AtlasSseEventType = (typeof ATLAS_SSE_EVENT_TYPES)[number];

/**
 * Adapt a `ConductorEvent` from the internal bus into the wire-shape
 * the atlas-ui client is typed against. Returns `null` if the event is
 * not project-scoped to the caller, not one of the three atlas types,
 * or has a payload shape we can't safely map.
 *
 * Mapping rationale per event type:
 *
 *   - `atlas.element.highlighted` — needs `ticket_id`, `dom_id`,
 *     `design_version_id` on payload. Missing any → return null.
 *   - `atlas.prompt.completed` — needs `ticket_id`, `prompt_group_id`,
 *     `result`. `version_id` is optional (omitted on `fail`).
 *   - `atlas.version.changed` — needs `design_version_id`.
 *     `previous_version_id` is required-nullable per the taxonomy.
 *
 * The wire shape uses camelCase (`ticketId`); the bus envelope uses
 * snake_case (`ticket_id`). This is the canonical seam.
 */
export function adaptConductorToWire(
  event: ConductorEvent,
  projectId: string,
): AtlasSseEvent | null {
  if (event.project_slug !== projectId) return null;

  const p = event.payload as Record<string, unknown>;

  if (event.type === 'atlas.element.highlighted') {
    const ticketId = stringField(p, 'ticket_id');
    const domId = stringField(p, 'dom_id');
    const designVersionId = stringField(p, 'design_version_id');
    if (!ticketId || !domId || !designVersionId) return null;
    return {
      type: 'atlas.element.highlighted',
      ticketId,
      domId,
      designVersionId,
      ts: stringField(p, 'ts') ?? event.occurred_at,
    };
  }

  if (event.type === 'atlas.prompt.completed') {
    const ticketId = stringField(p, 'ticket_id');
    const promptGroupId = stringField(p, 'prompt_group_id');
    const rawResult = stringField(p, 'result');
    if (!ticketId || !promptGroupId) return null;
    if (rawResult !== 'ok' && rawResult !== 'fail') return null;
    const versionId = stringField(p, 'version_id');
    return {
      type: 'atlas.prompt.completed',
      ticketId,
      promptGroupId,
      result: rawResult,
      ...(versionId ? { versionId } : {}),
      ts: stringField(p, 'ts') ?? event.occurred_at,
    };
  }

  if (event.type === 'atlas.version.changed') {
    const designVersionId = stringField(p, 'design_version_id');
    if (!designVersionId) return null;
    const previousVersionId = stringFieldOrNull(p, 'previous_version_id');
    return {
      type: 'atlas.version.changed',
      designVersionId,
      previousVersionId,
      ts: stringField(p, 'ts') ?? event.occurred_at,
    };
  }

  return null;
}

function stringField(p: Record<string, unknown>, key: string): string | undefined {
  const v = p[key];
  return typeof v === 'string' ? v : undefined;
}

function stringFieldOrNull(p: Record<string, unknown>, key: string): string | null {
  const v = p[key];
  if (typeof v === 'string') return v;
  if (v === null) return null;
  return null;
}

/**
 * Serialise a wire event to a single SSE frame. Frame format per the
 * EventSource spec (mirrors `@caia/state-machine`'s `SseConnection.send`):
 *
 *     id: <event-id>\n
 *     event: message\n
 *     data: <json>\n
 *     \n
 *
 * Multi-line `data` is split into multiple `data:` lines per spec.
 * `id` is optional — the route uses the event's `ts` field when present
 * so EventSource's `Last-Event-ID` reconnect header carries useful
 * context. `event: message` is the default — emitted explicitly so the
 * client's `addEventListener('message', …)` (in `createHttpClient`)
 * is hit deterministically across browsers.
 */
export function serialiseSseFrame(event: AtlasSseEvent, id?: string): string {
  const json = JSON.stringify(event);
  let frame = '';
  if (id) frame += `id: ${id}\n`;
  frame += 'event: message\n';
  for (const line of json.split('\n')) {
    frame += `data: ${line}\n`;
  }
  frame += '\n';
  return frame;
}

/** Keepalive comment per EventSource spec. Forces an in-flight write. */
export function serialiseKeepaliveComment(text = 'keepalive'): string {
  return `: ${text}\n\n`;
}

export interface SubscribeAtlasEventsOptions {
  projectId: string;
  /** Sink called for every project-scoped, mappable atlas event. */
  onWireEvent: (event: AtlasSseEvent) => void;
  /** Override the bus (tests). Defaults to the singleton `eventBus`. */
  bus?: typeof eventBus;
}

/**
 * Subscribe to the three atlas event types on the in-process bus,
 * filter by project, adapt, and forward to `onWireEvent`. Returns an
 * unsubscribe function that detaches all three subscriptions.
 *
 * Subscriptions are exact-type (not glob `atlas.*`) — see file header.
 */
export function subscribeAtlasEvents(
  opts: SubscribeAtlasEventsOptions,
): () => void {
  const bus = opts.bus ?? eventBus;
  const unsubs: Array<() => void> = [];

  for (const type of ATLAS_SSE_EVENT_TYPES) {
    const u = bus.subscribe(type, (event) => {
      const wire = adaptConductorToWire(event, opts.projectId);
      if (wire) opts.onWireEvent(wire);
    });
    unsubs.push(u);
  }

  return () => {
    for (const u of unsubs) {
      try {
        u();
      } catch {
        /* never bubble — the bus may have torn down */
      }
    }
  };
}

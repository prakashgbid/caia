/**
 * Unit tests for the atlas SSE adapter (`lib/atlas/sse.ts`) and the
 * route handler at `/api/atlas/project/[projectId]/events`. Covers:
 *
 *   - ConductorEvent → wire AtlasSseEvent translation (one case per
 *     supported atlas.* type plus happy/sad mappings).
 *   - SSE-frame serialisation (id, event, data lines, terminator).
 *   - Bus subscription scoping by project_slug.
 *   - Multi-event sequencing.
 *   - Subscription teardown.
 *   - Route handler — returns `text/event-stream`, opens with `: open`,
 *     emits a frame after a project-scoped publish, closes cleanly on
 *     client abort.
 *
 * Why no useAtlasSse hook tests in this file: `useAtlasSse` already
 * has dedicated tests in `packages/atlas-ui/tests/`. The hook is
 * unchanged in this PR — what's new is the server route + bus adapter
 * that finally satisfies the wire contract PR #545 declared.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';
import { eventBus } from '@chiefaia/event-bus-internal';

import {
  ATLAS_SSE_EVENT_TYPES,
  adaptConductorToWire,
  serialiseKeepaliveComment,
  serialiseSseFrame,
  subscribeAtlasEvents,
} from '../../lib/atlas/sse';

const PROJECT_ID = 'proj-c5-atlas';

/** Minimal ConductorEvent factory — fills the required envelope fields. */
function makeConductorEvent(
  partial: Pick<ConductorEvent, 'type' | 'payload'> &
    Partial<Pick<ConductorEvent, 'project_slug' | 'actor' | 'severity' | 'occurred_at'>>,
): ConductorEvent {
  return {
    id: 'ev_test_' + Math.random().toString(36).slice(2, 10),
    type: partial.type,
    occurred_at: partial.occurred_at ?? '2026-05-30T12:00:00.000Z',
    actor: partial.actor ?? 'system',
    project_slug: partial.project_slug ?? PROJECT_ID,
    domain_slugs: [],
    payload: partial.payload,
    metadata: {},
    severity: partial.severity ?? 'info',
  };
}

describe('adaptConductorToWire — atlas.element.highlighted', () => {
  it('maps a well-formed payload to the wire shape', () => {
    const ev = makeConductorEvent({
      type: 'atlas.element.highlighted',
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv-99',
        ts: '2026-05-30T12:01:00.000Z',
      },
    });
    const wire = adaptConductorToWire(ev, PROJECT_ID);
    expect(wire).toEqual({
      type: 'atlas.element.highlighted',
      ticketId: 't-1',
      domId: '#hero',
      designVersionId: 'dv-99',
      ts: '2026-05-30T12:01:00.000Z',
    });
  });

  it('falls back to event.occurred_at when payload.ts is missing', () => {
    const ev = makeConductorEvent({
      type: 'atlas.element.highlighted',
      occurred_at: '2026-06-01T00:00:00.000Z',
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv-99',
      },
    });
    const wire = adaptConductorToWire(ev, PROJECT_ID);
    expect(wire).not.toBeNull();
    expect(wire?.ts).toBe('2026-06-01T00:00:00.000Z');
  });

  it('returns null when ticket_id is missing', () => {
    const ev = makeConductorEvent({
      type: 'atlas.element.highlighted',
      payload: { project_id: PROJECT_ID, dom_id: '#hero', design_version_id: 'dv' },
    });
    expect(adaptConductorToWire(ev, PROJECT_ID)).toBeNull();
  });
});

describe('adaptConductorToWire — atlas.prompt.completed', () => {
  it('maps an ok result with a version_id', () => {
    const ev = makeConductorEvent({
      type: 'atlas.prompt.completed',
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-2',
        prompt_group_id: 'pg-1',
        result: 'ok',
        version_id: 'tv-42',
      },
    });
    const wire = adaptConductorToWire(ev, PROJECT_ID);
    expect(wire).toMatchObject({
      type: 'atlas.prompt.completed',
      ticketId: 't-2',
      promptGroupId: 'pg-1',
      result: 'ok',
      versionId: 'tv-42',
    });
  });

  it('maps a fail result without a version_id', () => {
    const ev = makeConductorEvent({
      type: 'atlas.prompt.completed',
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-3',
        prompt_group_id: 'pg-2',
        result: 'fail',
      },
    });
    const wire = adaptConductorToWire(ev, PROJECT_ID);
    expect(wire).toMatchObject({
      type: 'atlas.prompt.completed',
      ticketId: 't-3',
      result: 'fail',
    });
    expect(wire && 'versionId' in wire).toBe(false);
  });

  it('returns null for an invalid result value', () => {
    const ev = makeConductorEvent({
      type: 'atlas.prompt.completed',
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-3',
        prompt_group_id: 'pg-2',
        result: 'maybe',
      },
    });
    expect(adaptConductorToWire(ev, PROJECT_ID)).toBeNull();
  });
});

describe('adaptConductorToWire — atlas.version.changed', () => {
  it('maps a first-version event with previous_version_id = null', () => {
    const ev = makeConductorEvent({
      type: 'atlas.version.changed',
      payload: {
        project_id: PROJECT_ID,
        design_version_id: 'dv-1',
        previous_version_id: null,
      },
    });
    expect(adaptConductorToWire(ev, PROJECT_ID)).toEqual({
      type: 'atlas.version.changed',
      designVersionId: 'dv-1',
      previousVersionId: null,
      ts: '2026-05-30T12:00:00.000Z',
    });
  });

  it('maps an n+1 version event with a string previous_version_id', () => {
    const ev = makeConductorEvent({
      type: 'atlas.version.changed',
      payload: {
        project_id: PROJECT_ID,
        design_version_id: 'dv-2',
        previous_version_id: 'dv-1',
      },
    });
    const wire = adaptConductorToWire(ev, PROJECT_ID);
    expect(wire).toMatchObject({
      type: 'atlas.version.changed',
      designVersionId: 'dv-2',
      previousVersionId: 'dv-1',
    });
  });
});

describe('adaptConductorToWire — scoping & filtering', () => {
  it('returns null when project_slug does not match', () => {
    const ev = makeConductorEvent({
      type: 'atlas.element.highlighted',
      project_slug: 'other-project',
      payload: {
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv-99',
      },
    });
    expect(adaptConductorToWire(ev, PROJECT_ID)).toBeNull();
  });

  it('returns null for a non-atlas event type', () => {
    // `makeConductorEvent`'s `type` is loose enough (string union from
    // the taxonomy) that `'pipeline.started'` doesn't need a ts-suppress
    // here. The point of the test is the runtime guard, not the types.
    const ev = makeConductorEvent({
      type: 'pipeline.started',
      payload: { project_slug: PROJECT_ID, trigger: 'cron' },
    });
    expect(adaptConductorToWire(ev, PROJECT_ID)).toBeNull();
  });
});

describe('serialiseSseFrame', () => {
  it('emits id, event and data lines terminated by a blank line', () => {
    const wire = {
      type: 'atlas.element.highlighted' as const,
      ticketId: 't-1',
      domId: '#hero',
      designVersionId: 'dv-99',
      ts: '2026-05-30T12:01:00.000Z',
    };
    const frame = serialiseSseFrame(wire, wire.ts);
    expect(frame.startsWith(`id: ${wire.ts}\n`)).toBe(true);
    expect(frame).toContain('\nevent: message\n');
    expect(frame).toContain('"type":"atlas.element.highlighted"');
    expect(frame.endsWith('\n\n')).toBe(true);
  });

  it('omits id when not provided', () => {
    const wire = {
      type: 'atlas.version.changed' as const,
      designVersionId: 'dv-1',
      previousVersionId: null,
      ts: '2026-05-30T12:00:00.000Z',
    };
    const frame = serialiseSseFrame(wire);
    expect(frame.startsWith('event: message\n')).toBe(true);
    expect(frame).not.toContain('id:');
  });
});

describe('serialiseKeepaliveComment', () => {
  it('emits the SSE-spec comment line with default text', () => {
    expect(serialiseKeepaliveComment()).toBe(': keepalive\n\n');
  });

  it('honours custom text', () => {
    expect(serialiseKeepaliveComment('open')).toBe(': open\n\n');
  });
});

describe('subscribeAtlasEvents — bus integration', () => {
  // Tests reuse the global eventBus singleton — clean state per test
  // via the un-subscribe returned from subscribeAtlasEvents.
  let detach: (() => void) | null = null;

  afterEach(() => {
    detach?.();
    detach = null;
  });

  it('forwards a project-scoped highlight event to the sink', () => {
    const sink = vi.fn();
    detach = subscribeAtlasEvents({ projectId: PROJECT_ID, onWireEvent: sink });
    eventBus.publish({
      type: 'atlas.element.highlighted',
      actor: 'system',
      project_slug: PROJECT_ID,
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv-99',
      },
    });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({
      type: 'atlas.element.highlighted',
      ticketId: 't-1',
    });
  });

  it('drops events from other projects', () => {
    const sink = vi.fn();
    detach = subscribeAtlasEvents({ projectId: PROJECT_ID, onWireEvent: sink });
    eventBus.publish({
      type: 'atlas.element.highlighted',
      actor: 'system',
      project_slug: 'other-project',
      payload: {
        project_id: 'other-project',
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv-99',
      },
    });
    expect(sink).not.toHaveBeenCalled();
  });

  it('delivers multi-event sequences in publish order', () => {
    const sink = vi.fn();
    detach = subscribeAtlasEvents({ projectId: PROJECT_ID, onWireEvent: sink });
    eventBus.publish({
      type: 'atlas.element.highlighted',
      actor: 'system',
      project_slug: PROJECT_ID,
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv-1',
      },
    });
    eventBus.publish({
      type: 'atlas.prompt.completed',
      actor: 'executor',
      project_slug: PROJECT_ID,
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-1',
        prompt_group_id: 'pg-1',
        result: 'ok',
        version_id: 'tv-1',
      },
    });
    eventBus.publish({
      type: 'atlas.version.changed',
      actor: 'system',
      project_slug: PROJECT_ID,
      payload: {
        project_id: PROJECT_ID,
        design_version_id: 'dv-2',
        previous_version_id: 'dv-1',
      },
    });

    expect(sink).toHaveBeenCalledTimes(3);
    expect(sink.mock.calls.map((c) => c[0].type)).toEqual([
      'atlas.element.highlighted',
      'atlas.prompt.completed',
      'atlas.version.changed',
    ]);
  });

  it('stops delivering once unsubscribed', () => {
    const sink = vi.fn();
    detach = subscribeAtlasEvents({ projectId: PROJECT_ID, onWireEvent: sink });
    detach();
    detach = null;
    eventBus.publish({
      type: 'atlas.element.highlighted',
      actor: 'system',
      project_slug: PROJECT_ID,
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-1',
        dom_id: '#hero',
        design_version_id: 'dv',
      },
    });
    expect(sink).not.toHaveBeenCalled();
  });

  it('exposes the three subscribed event types as a constant', () => {
    expect([...ATLAS_SSE_EVENT_TYPES].sort()).toEqual([
      'atlas.element.highlighted',
      'atlas.prompt.completed',
      'atlas.version.changed',
    ]);
  });
});

describe('GET /api/atlas/project/[projectId]/events', () => {
  // Lazy import so the route file (which has its own runtime exports)
  // isn't loaded for unrelated tests.
  async function loadRoute(): Promise<typeof import('../../app/api/atlas/project/[projectId]/events/route')> {
    return await import('../../app/api/atlas/project/[projectId]/events/route');
  }

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function makeReq(): {
    req: { signal: AbortSignal };
    abort: () => void;
  } {
    const controller = new AbortController();
    return {
      req: { signal: controller.signal },
      abort: () => controller.abort(),
    };
  }

  it('returns an SSE response with the right headers', async () => {
    const { GET } = await loadRoute();
    const { req, abort } = makeReq();
    const res = await GET(req as unknown as Parameters<typeof GET>[0], {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    expect(res.headers.get('cache-control')).toMatch(/no-cache/);
    // Cleanup so the timer doesn't leak.
    abort();
  });

  it('emits an open comment then a frame after a project-scoped publish', async () => {
    const { GET } = await loadRoute();
    const { req, abort } = makeReq();
    const res = await GET(req as unknown as Parameters<typeof GET>[0], {
      params: Promise.resolve({ projectId: PROJECT_ID }),
    });
    expect(res.body).not.toBeNull();
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();

    // First chunk: `: open\n\n` (open comment).
    const first = await reader.read();
    expect(decoder.decode(first.value)).toBe(': open\n\n');

    // Publishing in-process now should produce a frame on the next read.
    eventBus.publish({
      type: 'atlas.prompt.completed',
      actor: 'executor',
      project_slug: PROJECT_ID,
      payload: {
        project_id: PROJECT_ID,
        ticket_id: 't-route',
        prompt_group_id: 'pg-route',
        result: 'ok',
        version_id: 'tv-route',
      },
    });
    const second = await reader.read();
    const txt = decoder.decode(second.value);
    expect(txt).toMatch(/event: message/);
    expect(txt).toMatch(/"type":"atlas\.prompt\.completed"/);
    expect(txt).toMatch(/"ticketId":"t-route"/);
    expect(txt).toMatch(/"versionId":"tv-route"/);

    abort();
  });

  it('returns 400 when projectId is empty', async () => {
    const { GET } = await loadRoute();
    const { req } = makeReq();
    const res = await GET(req as unknown as Parameters<typeof GET>[0], {
      params: Promise.resolve({ projectId: '' }),
    });
    expect(res.status).toBe(400);
  });
});

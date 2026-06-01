/**
 * `POST /api/atlas/__test/publish` — test-only publisher.
 *
 * Lets the Playwright atlas-SSE spec fire a synthetic atlas event onto
 * the in-process `@chiefaia/event-bus-internal` singleton without
 * needing to spin up a worker. The atlas SSE route at
 * `/api/atlas/project/:id/events` is subscribed to the same bus, so
 * the event lands on the connected EventSource within the same Node
 * process and the UI's `useAtlasSse` hook surfaces it.
 *
 * Guarded by `ATLAS_SSE_TEST_PUBLISH=1` — when unset (i.e. prod),
 * returns 404 and refuses to publish. Playwright's `webServer.env`
 * sets this flag for the test run only.
 *
 * Body shape:
 *   {
 *     "type": "atlas.element.highlighted" | "atlas.prompt.completed" | "atlas.version.changed",
 *     "projectId": "<scope>",
 *     "payload": { ...event-specific fields per registry.yaml }
 *   }
 */

import { type NextRequest } from 'next/server';
import { eventBus } from '@chiefaia/event-bus-internal';

import { ATLAS_SSE_EVENT_TYPES } from '../../../../../lib/atlas/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PublishBody {
  type: string;
  projectId: string;
  payload?: Record<string, unknown>;
}

export async function POST(req: NextRequest): Promise<Response> {
  if (process.env.ATLAS_SSE_TEST_PUBLISH !== '1') {
    return new Response('not found', { status: 404 });
  }

  let body: PublishBody;
  try {
    body = (await req.json()) as PublishBody;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid-json' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!body.projectId || typeof body.projectId !== 'string') {
    return new Response(JSON.stringify({ error: 'missing-projectId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  if (!ATLAS_SSE_EVENT_TYPES.includes(body.type as (typeof ATLAS_SSE_EVENT_TYPES)[number])) {
    return new Response(JSON.stringify({ error: 'unknown-type', got: body.type }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const published = eventBus.publish({
    type: body.type as (typeof ATLAS_SSE_EVENT_TYPES)[number],
    actor: 'system',
    project_slug: body.projectId,
    payload: {
      project_id: body.projectId,
      ...(body.payload ?? {}),
    },
  });

  return new Response(JSON.stringify({ ok: true, id: published.id }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

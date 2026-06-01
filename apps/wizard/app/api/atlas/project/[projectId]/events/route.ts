/**
 * `GET /api/atlas/project/:projectId/events` — Server-Sent Events.
 *
 * Wire contract — set in PR #545 (`@caia/atlas-ui`):
 *   `AtlasApiClient.subscribeEvents` (in `packages/atlas-ui/src/api/
 *   client.ts`) opens an `EventSource` against this exact URL and
 *   parses `JSON.parse(e.data)` as a wire-shape `AtlasSseEvent`. The
 *   atlas-ui `useAtlasSse` hook surfaces those as React state. This
 *   route is the missing server half of that contract.
 *
 * What it does:
 *   1. Opens a `text/event-stream` response with a `ReadableStream`.
 *   2. Subscribes to the three `atlas.*` event types on
 *      `@chiefaia/event-bus-internal` (via the pure adapter at
 *      `apps/wizard/lib/atlas/sse.ts`).
 *   3. For each project-scoped event, enqueues an SSE frame on the
 *      stream controller.
 *   4. Sends a `:keepalive` comment every 15s so intermediaries don't
 *      idle-time-out the connection.
 *   5. Unsubscribes from the bus and closes the stream on
 *      `req.signal.abort` (client disconnect).
 *
 * Why the path includes `project/`: the existing `createHttpClient`
 * already calls `/api/atlas/project/${encodeURIComponent(projectId)}/
 * events`, so the route segments must include `project/` to match. The
 * C5 brief said `apps/wizard/app/api/atlas/[projectId]/events` —
 * approximate path-string; the in-tree wire contract from PR #545
 * wins, and the EA plan notes the adjustment.
 *
 * Why no auth gate inline here: the wizard's middleware
 * (`apps/wizard/middleware.ts`) already gates every `/api/*` route
 * with the same Cloudflare-Access JWT / edge-bypass logic flipped in
 * PR #625. Routes that need additional tenant scoping read the
 * resolved tenant from `X-Caia-Tenant-*` headers the middleware sets.
 * This route is read-only and scope-bound by the URL's `projectId`, so
 * no further check is needed.
 *
 * Subscription-only Claude Max compliance: this endpoint does NOT call
 * any LLM. It is a pure pipe between the in-process event bus and the
 * client's `EventSource`.
 */

import type { NextRequest } from 'next/server';

import {
  serialiseKeepaliveComment,
  serialiseSseFrame,
  subscribeAtlasEvents,
} from '../../../../../../lib/atlas/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ projectId: string }>;
}

/** Keepalive cadence — matches `SseConnection`'s default (15s). */
const KEEPALIVE_MS = 15_000;

export async function GET(req: NextRequest, ctx: RouteContext): Promise<Response> {
  const { projectId } = await ctx.params;

  if (!projectId || typeof projectId !== 'string') {
    return new Response(JSON.stringify({ error: 'missing-project-id' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();

  // The stream's `cancel` is called both when the client disconnects
  // (req.signal aborts) and when the controller is .close()'d on our
  // side. We hoist `unsubscribe` so both paths converge on detach.
  let unsubscribe: (() => void) | null = null;
  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller): void {
      // Eagerly send a `: open` comment so the client's EventSource
      // resolves its onopen tick deterministically (some intermediaries
      // buffer until the first byte lands).
      controller.enqueue(encoder.encode(serialiseKeepaliveComment('open')));

      unsubscribe = subscribeAtlasEvents({
        projectId,
        onWireEvent: (event): void => {
          // `ts` field is present on every wire variant — use it as
          // the SSE `id:` so `Last-Event-ID` reconnect carries
          // monotonic-ish context. (We don't yet replay, but this
          // primes the spec hook for later.)
          const frame = serialiseSseFrame(event, event.ts);
          try {
            controller.enqueue(encoder.encode(frame));
          } catch {
            // Controller already closed — detach so the bus doesn't
            // keep delivering into a dead stream.
            unsubscribe?.();
            unsubscribe = null;
          }
        },
      });

      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(serialiseKeepaliveComment()));
        } catch {
          // Stream gone; clear the timer.
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }
        }
      }, KEEPALIVE_MS);

      // Client-side disconnect: detach.
      req.signal.addEventListener('abort', () => {
        unsubscribe?.();
        unsubscribe = null;
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },

    cancel(): void {
      // Either the underlying transport tore down or the client called
      // EventSource.close(). Same teardown either way.
      unsubscribe?.();
      unsubscribe = null;
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Nginx / Cloudflare hint — disable response buffering so SSE
      // frames hit the wire immediately.
      'x-accel-buffering': 'no',
    },
  });
}

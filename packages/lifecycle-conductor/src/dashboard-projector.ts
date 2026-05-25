/**
 * @caia/lifecycle-conductor — dashboard SSE projector.
 *
 * Feeds the operator dashboard via Server-Sent Events. Reuses
 * `SseConnection` from `@caia/state-machine/realtime` — the same
 * infrastructure the pipeline-conductor's project-status stream uses
 * (PR #564 merged) — so the dashboard's transport layer is identical
 * regardless of whether it's subscribing to the project FSM or the
 * solution-lifecycle FSM.
 *
 * Frame contract:
 *   `event: snapshot`     — initial full payload on connect
 *   `event: composite`    — per composite-state change (one frame per
 *                           `CompositeStateChangedEvent`)
 *   `event: ping`         — periodic keepalive (handled by
 *                           SseConnection's keepaliveTimer)
 *
 * Three subscription modes:
 *   1. `projectToSse(req, res, { solutionId })` — single solution.
 *   2. `projectAllToSse(req, res)` — all solutions known to the
 *      aggregator. Each composite-state change frame includes the
 *      `solutionId` so the client can route.
 *   3. `createSseFanout(api)` returns a `(handler) => unsubscribe`
 *      object the daemon hands to an HTTP server.
 *
 * The projector is stateless beyond the `SseConnection` — the
 * aggregator's `onCompositeStateChanged` hook is the source of truth.
 */

import { SseConnection } from '@caia/state-machine';
import type { IncomingMessage, ServerResponse } from 'node:http';

import type { LifecycleConductorApi, SolutionLifecycleView } from './api.js';
import type { CompositeStateChangedEvent } from './types.js';

export interface ProjectToSseOptions {
  /** Subscribe to a specific solution. If omitted, subscribe to all
   * solutions and include `solutionId` on every frame. */
  solutionId?: string;
  /** Frame-level keepalive interval in ms. Default 15s, same as
   * `SseConnection`. */
  keepaliveMs?: number;
}

export interface SseFanoutHandle {
  /** Subscribe a handler that fires on every composite-state change
   * the aggregator emits. Returns an unsubscribe. */
  onChange(
    handler: (event: CompositeStateChangedEvent) => void,
  ): () => void;
  /** Receive the next composite-state change envelope directly into
   * the fanout — used by the aggregator's `onCompositeStateChanged`
   * hook to push into the SSE fanout. */
  emit(event: CompositeStateChangedEvent): void;
}

/**
 * Create a stateless fanout the aggregator can push into and the SSE
 * projector can pull from. Pattern matches `@chiefaia/event-bus-internal`'s
 * subscription model: every subscriber receives every event; no per
 * -solution filtering at the fanout layer (callers filter).
 */
export function createSseFanout(): SseFanoutHandle {
  const handlers = new Set<(e: CompositeStateChangedEvent) => void>();
  return {
    onChange(handler): () => void {
      handlers.add(handler);
      return (): void => {
        handlers.delete(handler);
      };
    },
    emit(event): void {
      for (const h of [...handlers]) {
        try {
          h(event);
        } catch {
          /* swallow handler errors */
        }
      }
    },
  };
}

/**
 * Wire an SSE endpoint to the lifecycle conductor.
 *
 * - On connect: send a `snapshot` event with the current state.
 * - On every composite-state change: send a `composite` event.
 * - On disconnect: unsubscribe.
 */
export async function projectToSse(
  api: LifecycleConductorApi,
  fanout: SseFanoutHandle,
  req: IncomingMessage,
  res: ServerResponse,
  opts: ProjectToSseOptions = {},
): Promise<void> {
  const conn = new SseConnection(res, opts.keepaliveMs);

  // 1. Send the initial snapshot.
  if (opts.solutionId !== undefined) {
    const view = await api.getSolutionLifecycle(opts.solutionId);
    if (view === null) {
      conn.sendJson('error', {
        error: 'solution-not-found',
        solution_id: opts.solutionId,
      });
      conn.close();
      return;
    }
    conn.sendJson('snapshot', view, view.solutionId);
  } else {
    const list = await api.listIncompleteSolutions();
    conn.sendJson('snapshot', { incomplete: list, count: list.length });
  }

  // 2. Subscribe to ongoing changes.
  const targetSolutionId = opts.solutionId;
  const unsub = fanout.onChange((event) => {
    if (targetSolutionId !== undefined && event.solutionId !== targetSolutionId) {
      return;
    }
    conn.sendJson('composite', envelopeFor(event), event.solutionId);
  });

  // 3. Tear down on client disconnect.
  const cleanup = (): void => {
    try {
      unsub();
    } catch {
      /* ignore */
    }
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}

/**
 * Convert the aggregator's internal `CompositeStateChangedEvent` into
 * the wire envelope the dashboard expects. Wire schema is JSON-safe
 * (no Date objects, no Sets/Maps).
 */
function envelopeFor(event: CompositeStateChangedEvent): {
  solutionId: string;
  fromState: string;
  toState: string;
  trigger: string;
  at: string;
  rowsSnapshot: Record<string, unknown>;
} {
  return {
    solutionId: event.solutionId,
    fromState: event.fromState,
    toState: event.toState,
    trigger: event.trigger,
    at: event.at,
    rowsSnapshot: event.rowsSnapshot,
  };
}

// Re-exports for callers that build their own projector wrappers.
export { SseConnection };
export type { SolutionLifecycleView };

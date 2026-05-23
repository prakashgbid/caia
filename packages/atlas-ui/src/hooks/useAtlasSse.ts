/**
 * `useAtlasSse` — subscribe to the project's SSE event stream and
 * surface incoming events as React state.
 *
 * Spec §5.5 + §11.2 — the panel needs to render live agent status
 * (running, finished, failed) plus toasts when an agent finishes
 * a ticket. Atlas-UI is a library so it doesn't ship a toast UI;
 * we expose the event list and let the host app's toaster react.
 */

import { useEffect, useRef, useState } from 'react';

import type { AtlasApiClient } from '../api/index.js';
import type { AtlasSseEvent } from '../types/index.js';

export interface UseAtlasSseOptions {
  /** Project id to subscribe to. */
  projectId: string;
  /** API client. */
  client: AtlasApiClient;
  /** Optional cap on stored events. Defaults to 200. Older events drop FIFO. */
  maxEvents?: number;
  /** Called on every event (no need to read state). */
  onEvent?: (e: AtlasSseEvent) => void;
}

export interface UseAtlasSseResult {
  /** Most-recent-last list of events. */
  events: AtlasSseEvent[];
  /** Most recent event of each type, keyed by ticketId where applicable. */
  byTicketId: Map<string, AtlasSseEvent>;
  /** Last connection error, if any. */
  error: Error | null;
  /** True when the subscription is currently live. */
  connected: boolean;
}

const DEFAULT_MAX = 200;

export function useAtlasSse(opts: UseAtlasSseOptions): UseAtlasSseResult {
  const [events, setEvents] = useState<AtlasSseEvent[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [connected, setConnected] = useState(false);
  const maxEvents = opts.maxEvents ?? DEFAULT_MAX;
  const onEventRef = useRef(opts.onEvent);
  onEventRef.current = opts.onEvent;

  useEffect(() => {
    setConnected(true);
    setError(null);
    const unsub = opts.client.subscribeEvents(
      opts.projectId,
      (e) => {
        setEvents((prev) => {
          const next = [...prev, e];
          if (next.length > maxEvents) next.splice(0, next.length - maxEvents);
          return next;
        });
        onEventRef.current?.(e);
      },
      (err) => {
        setError(err);
        setConnected(false);
      },
    );
    return () => {
      unsub();
      setConnected(false);
    };
  }, [opts.client, opts.projectId, maxEvents]);

  // Memoise the by-ticket map. Recomputed only when the events array
  // identity changes (which is whenever a new event lands).
  const byTicketId = new Map<string, AtlasSseEvent>();
  for (const e of events) {
    if ('ticketId' in e) byTicketId.set(e.ticketId, e);
  }

  return { events, byTicketId, error, connected };
}

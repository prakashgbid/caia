'use client';
import { useEffect, useRef, useState } from 'react';

/**
 * Normalized WS event shape consumed by dashboard pages.
 *
 * The orchestrator ships canonical `ConductorEvent` envelopes over WS where
 * the discriminating field is `type` (and timestamp lives in `occurred_at`,
 * project in `project_slug`). The dashboard's hooks/components were originally
 * written against an older shape using `kind` / `ts` / `projectId`, so
 * `parseWsMessage` adapts the canonical shape to the legacy one. The
 * connection ack `{kind:'connected'}` is filtered out.
 *
 * The `type` field is also preserved so newer code can read it directly.
 */
export interface WsEvent {
  /** Alias of `type` for legacy consumers (`task.completed`, etc.). */
  kind: string;
  /** Canonical event-type string from the events taxonomy. */
  type?: string;
  id?: string;
  projectId?: string;
  payload?: unknown;
  ts: string;
}

/** Shape a WS payload with at least one of the expected discriminators. */
interface IncomingMessage {
  kind?: string;
  type?: string;
  id?: string;
  project_slug?: string;
  projectId?: string;
  payload?: unknown;
  occurred_at?: string;
  ts?: string;
}

/**
 * Pure parser exposed for unit tests. Returns `null` for connection acks
 * and unparseable input, otherwise a normalized `WsEvent`.
 */
export function parseWsMessage(raw: string): WsEvent | null {
  let data: IncomingMessage;
  try {
    data = JSON.parse(raw) as IncomingMessage;
  } catch {
    return null;
  }

  // Connection ack — server sends {kind:'connected', ts}
  if (data.kind === 'connected') return null;

  // Canonical ConductorEvent envelope (field: type)
  if (typeof data.type === 'string') {
    return {
      kind: data.type,
      type: data.type,
      id: data.id,
      projectId: data.project_slug ?? data.projectId,
      payload: data.payload,
      ts: data.occurred_at ?? data.ts ?? new Date().toISOString(),
    };
  }

  // Legacy WS-only envelope (field: kind)
  if (typeof data.kind === 'string') {
    return {
      kind: data.kind,
      id: data.id,
      projectId: data.projectId,
      payload: data.payload,
      ts: data.ts ?? new Date().toISOString(),
    };
  }

  return null;
}

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => setConnected(true);
        ws.onclose = () => {
          setConnected(false);
          reconnectTimer = setTimeout(connect, 3000);
        };
        ws.onerror = () => ws.close();
        ws.onmessage = (msg) => {
          const evt = parseWsMessage(msg.data as string);
          if (evt) setLastEvent(evt);
        };
      } catch {
        reconnectTimer = setTimeout(connect, 3000);
      }
    }

    connect();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [url]);

  return { lastEvent, connected };
}

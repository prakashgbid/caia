'use client';
import { useEffect, useRef, useState } from 'react';

export interface WsEvent {
  kind: string;
  id?: string;
  projectId?: string;
  payload?: unknown;
  ts: string;
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
          try {
            const data = JSON.parse(msg.data as string) as WsEvent;
            if (data.kind !== 'connected') {
              setLastEvent(data);
            }
          } catch { /* ignore parse errors */ }
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

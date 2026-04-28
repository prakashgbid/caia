'use client';
import { useEffect, useState } from 'react';

export interface WsEvent {
  kind: string;
  id?: string;
  projectId?: string;
  payload?: unknown;
  ts: string;
}

type EventListener = (event: WsEvent) => void;
type ConnectedListener = (connected: boolean) => void;

// ─── Module-level singleton ───────────────────────────────────────────────────
let _ws: WebSocket | null = null;
let _connected = false;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const _eventListeners = new Set<EventListener>();
const _connectedListeners = new Set<ConnectedListener>();

function notifyConnected(state: boolean) {
  _connected = state;
  _connectedListeners.forEach(fn => fn(state));
}

function notifyEvent(event: WsEvent) {
  _eventListeners.forEach(fn => fn(event));
}

function connectSingleton(url: string) {
  if (_ws && (_ws.readyState === WebSocket.CONNECTING || _ws.readyState === WebSocket.OPEN)) return;

  try {
    _ws = new WebSocket(url);

    _ws.onopen = () => notifyConnected(true);

    _ws.onclose = () => {
      notifyConnected(false);
      _ws = null;
      if (_reconnectTimer) clearTimeout(_reconnectTimer);
      _reconnectTimer = setTimeout(() => connectSingleton(url), 3000);
    };

    _ws.onerror = () => _ws?.close();

    _ws.onmessage = (msg) => {
      try {
        const data = JSON.parse(msg.data as string) as WsEvent;
        if (data.kind !== 'connected') {
          notifyEvent(data);
        }
      } catch { /* ignore parse errors */ }
    };
  } catch {
    _reconnectTimer = setTimeout(() => connectSingleton(url), 3000);
  }
}

const WS_URL = 'ws://localhost:7776/events';

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useEventStream() {
  const [lastEvent, setLastEvent] = useState<WsEvent | null>(null);
  const [connected, setConnected] = useState(_connected);

  useEffect(() => {
    connectSingleton(WS_URL);

    const onEvent: EventListener = (e) => setLastEvent(e);
    const onConnected: ConnectedListener = (c) => setConnected(c);

    _eventListeners.add(onEvent);
    _connectedListeners.add(onConnected);

    // Sync initial state
    setConnected(_connected);

    return () => {
      _eventListeners.delete(onEvent);
      _connectedListeners.delete(onConnected);
    };
  }, []);

  return { lastEvent, connected };
}

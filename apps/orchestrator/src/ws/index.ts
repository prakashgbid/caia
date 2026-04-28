import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { eventBus } from '../events/bus-adapter';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';

export function attachWsServer(httpServer: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/events' });

  wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({ kind: 'connected', ts: new Date().toISOString() }));

    const listener = (event: ConductorEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    };

    eventBus.on('conductor:event', listener);

    ws.on('close', () => { eventBus.off('conductor:event', listener); });
    ws.on('error', () => { eventBus.off('conductor:event', listener); });
  });

  return wss;
}

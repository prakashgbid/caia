import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { bus, type ConductorWsEvent } from './bus';

export function attachWsServer(httpServer: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/events' });

  wss.on('connection', (ws: WebSocket) => {
    ws.send(JSON.stringify({ kind: 'connected', ts: new Date().toISOString() }));

    const listener = (event: ConductorWsEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
      }
    };

    bus.on('conductor:event', listener);

    ws.on('close', () => {
      bus.off('conductor:event', listener);
    });

    ws.on('error', () => {
      bus.off('conductor:event', listener);
    });
  });

  return wss;
}

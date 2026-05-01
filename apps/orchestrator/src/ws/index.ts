import * as http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { eventBus } from '../events/bus-adapter';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';
import { conductorMetrics } from '../observability/conductor-metrics';

export function attachWsServer(httpServer: http.Server): WebSocketServer {
  const wss = new WebSocketServer({ server: httpServer, path: '/events' });

  wss.on('connection', (ws: WebSocket) => {
    const connectedAt = Date.now();
    conductorMetrics.recordWsConnected();

    const connectMsg = JSON.stringify({ kind: 'connected', ts: new Date().toISOString() });
    ws.send(connectMsg);
    conductorMetrics.recordWsMessageSent('connected');

    const listener = (event: ConductorEvent) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(event));
        conductorMetrics.recordWsMessageSent(event.type ?? 'unknown');
      }
    };

    eventBus.on('conductor:event', listener);

    ws.on('close', () => {
      eventBus.off('conductor:event', listener);
      conductorMetrics.recordWsDisconnected(connectedAt, 'closed');
    });
    ws.on('error', () => {
      eventBus.off('conductor:event', listener);
      conductorMetrics.recordWsDisconnected(connectedAt, 'error');
    });
  });

  return wss;
}

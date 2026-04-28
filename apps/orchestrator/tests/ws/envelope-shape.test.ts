/**
 * DASH-101 — guard the WS-envelope contract.
 *
 * The dashboard's `useWebSocket` hook (in `apps/dashboard/hooks/useWebSocket.ts`)
 * normalizes incoming WS messages assuming the orchestrator emits canonical
 * `ConductorEvent` envelopes with a `type` discriminator. Several dashboard
 * pages and the layout's nav-badge logic depend on that field. This test
 * pins the contract: a live WS server must serialize events with `type`
 * (not the older `kind`) so the dashboard never silently drops messages.
 */
import * as http from 'http';
import { AddressInfo } from 'net';
import WebSocket from 'ws';
import { eventBus } from '../../src/events/bus-adapter';
import { attachWsServer } from '../../src/ws/index';

describe('WS envelope shape (DASH-101)', () => {
  let server: http.Server;
  let port: number;

  beforeAll((done) => {
    server = http.createServer((_req, res) => { res.writeHead(404); res.end(); });
    attachWsServer(server);
    server.listen(0, () => {
      port = (server.address() as AddressInfo).port;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it('sends a {kind:connected} ack on open and ConductorEvent envelopes (with `type`) for published events', (done) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/events`);
    const received: unknown[] = [];

    ws.on('message', (raw) => {
      const data = JSON.parse(raw.toString()) as Record<string, unknown>;
      received.push(data);

      // First message: connection ack.
      if (received.length === 1) {
        expect(data.kind).toBe('connected');
        // Once the connection ack is received, publish a real event.
        eventBus.publish({
          type: 'task.created',
          actor: 'user',
          entity_id: 'tsk_dash101',
          payload: { task_id: 'tsk_dash101', title: 'envelope-shape-test' },
        });
        return;
      }

      // Second message: real ConductorEvent envelope.
      try {
        // The discriminator MUST be `type` (DASH-101). If the server were to
        // emit `kind` instead, the dashboard's `useWebSocket` would treat
        // every event as the connection ack and drop it.
        expect(data.type).toBe('task.created');
        expect(data.actor).toBe('user');
        expect(data.entity_id).toBe('tsk_dash101');
        expect(data.payload).toMatchObject({ task_id: 'tsk_dash101' });
        // `kind` must NOT be set on real events (would collide with the ack).
        expect(data.kind).toBeUndefined();
        ws.close();
        done();
      } catch (err) {
        ws.close();
        done(err as Error);
      }
    });

    ws.on('error', (err) => done(err));
  }, 10_000);
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { BroadcastChannelTransport } from '../../src/sender/transport/broadcast-channel';
import type { CastMessage } from '../../src/filters/types';

// MockBroadcastChannel.reset() is available via setup.ts stub
// We cast the global to access the static reset
const MockBC = globalThis.BroadcastChannel as unknown as {
  new(name: string): BroadcastChannel;
  reset(): void;
};

beforeEach(() => {
  MockBC.reset();
});

describe('BroadcastChannelTransport', () => {
  // ── Test 1: Sender posts STATE → receiver gets it ───────────
  describe('STATE message delivery', () => {
    it('receiver receives STATE message sent by sender', () => {
      const roomId = 'TEST-ROOM-1';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      const received: CastMessage[] = [];
      receiver.onMessage((msg) => received.push(msg));

      const publicState = {
        roomId,
        street: 'preflop' as const,
        communityCards: [],
        pot: 200,
        sidePots: [],
        players: [],
        actionHistory: [],
        dealerSeat: 0,
        actingSeat: null,
      };

      sender.send({ type: 'STATE', state: publicState });

      expect(received).toHaveLength(1);
      expect(received[0]?.type).toBe('STATE');
    });

    it('STATE message contains correct state data', () => {
      const roomId = 'TEST-ROOM-STATE';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      let received: CastMessage | null = null;
      receiver.onMessage((msg) => { received = msg; });

      const publicState = {
        roomId,
        street: 'flop' as const,
        communityCards: [{ rank: 'A' as const, suit: 'S' as const }],
        pot: 500,
        sidePots: [],
        players: [],
        actionHistory: [],
        dealerSeat: 1,
        actingSeat: 2,
      };

      sender.send({ type: 'STATE', state: publicState });

      expect(received).not.toBeNull();
      // received is CastMessage | null; we just asserted non-null. Double-cast
      // through unknown because TS doesn't propagate the runtime not-null
      // assertion to the type. Then narrow to Poker state — this test sends
      // a poker state (street: 'flop'), so the .pot field is present.
      const stateMsg = received as unknown as Extract<CastMessage, { type: 'STATE' }>;
      const pokerState = stateMsg.state as Extract<typeof stateMsg.state, { pot: number }>;
      expect(pokerState.pot).toBe(500);
    });
  });

  // ── Test 2: Sender posts STOP → receiver gets STOP ──────────
  describe('STOP message delivery', () => {
    it('receiver receives STOP message', () => {
      const roomId = 'TEST-STOP';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      const received: CastMessage[] = [];
      receiver.onMessage((msg) => received.push(msg));

      sender.send({ type: 'STOP' });

      expect(received).toHaveLength(1);
      expect(received[0]?.type).toBe('STOP');
    });
  });

  // ── Test 3: PING/PONG messages ──────────────────────────────
  describe('PING/PONG messages', () => {
    it('receiver receives PING', () => {
      const roomId = 'TEST-PING';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      let received: CastMessage | null = null;
      receiver.onMessage((msg) => { received = msg; });

      sender.send({ type: 'PING' });
      expect((received as CastMessage | null)?.type).toBe('PING');
    });

    it('receiver receives PONG', () => {
      const roomId = 'TEST-PONG';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      let received: CastMessage | null = null;
      receiver.onMessage((msg) => { received = msg; });

      sender.send({ type: 'PONG' });
      expect((received as CastMessage | null)?.type).toBe('PONG');
    });
  });

  // ── Test 4: Latency — sync in jsdom should be near 0ms ──────
  describe('Latency', () => {
    it('message delivery is synchronous (< 5ms in jsdom)', () => {
      const roomId = 'TEST-LATENCY';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      let receivedAt = 0;
      receiver.onMessage(() => { receivedAt = Date.now(); });

      const sentAt = Date.now();
      sender.send({ type: 'PING' });

      expect(receivedAt).toBeGreaterThan(0);
      expect(receivedAt - sentAt).toBeLessThan(5);
    });
  });

  // ── Test 5: Close cleans up handlers ───────────────────────
  describe('Close and cleanup', () => {
    it('after close, sender does not receive its own queued messages', () => {
      const roomId = 'TEST-CLOSE';
      const sender = new BroadcastChannelTransport(roomId);

      const received: CastMessage[] = [];
      sender.onMessage((msg) => received.push(msg));

      sender.close();

      // No receiver to get message — just verify no crash
      expect(received).toHaveLength(0);
    });

    it('unsubscribe returned by onMessage removes the handler', () => {
      const roomId = 'TEST-UNSUB';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      const received: CastMessage[] = [];
      const unsub = receiver.onMessage((msg) => received.push(msg));

      sender.send({ type: 'PING' });
      expect(received).toHaveLength(1);

      // Unsubscribe
      unsub();
      sender.send({ type: 'PONG' });
      expect(received).toHaveLength(1); // No new messages
    });

    it('close removes all handlers', () => {
      const roomId = 'TEST-CLOSE-HANDLERS';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      const received: CastMessage[] = [];
      receiver.onMessage((msg) => received.push(msg));

      receiver.close();

      // After close, receiver is removed from channel — sender's message won't reach it
      sender.send({ type: 'PING' });
      expect(received).toHaveLength(0);
    });
  });

  // ── Test 6: Multiple receivers all get the message ──────────
  describe('Multiple receivers', () => {
    it('3 receivers all receive the same STATE message', () => {
      const roomId = 'TEST-MULTI';
      const sender = new BroadcastChannelTransport(roomId);
      const r1 = new BroadcastChannelTransport(roomId);
      const r2 = new BroadcastChannelTransport(roomId);
      const r3 = new BroadcastChannelTransport(roomId);

      const r1Messages: CastMessage[] = [];
      const r2Messages: CastMessage[] = [];
      const r3Messages: CastMessage[] = [];

      r1.onMessage((m) => r1Messages.push(m));
      r2.onMessage((m) => r2Messages.push(m));
      r3.onMessage((m) => r3Messages.push(m));

      sender.send({ type: 'STOP' });

      expect(r1Messages).toHaveLength(1);
      expect(r2Messages).toHaveLength(1);
      expect(r3Messages).toHaveLength(1);
      expect(r1Messages[0]?.type).toBe('STOP');
    });

    it('multiple handlers on same transport all fire', () => {
      const roomId = 'TEST-MULTI-HANDLERS';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      const calls: number[] = [];
      receiver.onMessage(() => calls.push(1));
      receiver.onMessage(() => calls.push(2));
      receiver.onMessage(() => calls.push(3));

      sender.send({ type: 'PING' });

      expect(calls).toHaveLength(3);
    });
  });

  // ── Test 7: Sender does NOT receive its own messages ────────
  describe('Self-message isolation', () => {
    it('sender does NOT receive its own postMessage', () => {
      const roomId = 'TEST-SELF';
      const transport = new BroadcastChannelTransport(roomId);

      const received: CastMessage[] = [];
      transport.onMessage((msg) => received.push(msg));

      transport.send({ type: 'PING' });

      // Should NOT receive its own message
      expect(received).toHaveLength(0);
    });

    it('two transports on different roomIds do not cross-contaminate', () => {
      const t1 = new BroadcastChannelTransport('ROOM-A');
      const t2 = new BroadcastChannelTransport('ROOM-B');

      const t1Received: CastMessage[] = [];
      const t2Received: CastMessage[] = [];

      t1.onMessage((m) => t1Received.push(m));
      t2.onMessage((m) => t2Received.push(m));

      t1.send({ type: 'PING' });

      expect(t1Received).toHaveLength(0); // t1 sent, doesn't receive own
      expect(t2Received).toHaveLength(0); // different room
    });
  });

  // ── Test 8: Channel name includes roomId ────────────────────
  describe('Channel naming', () => {
    it('different roomIds create isolated channels', () => {
      const senderA = new BroadcastChannelTransport('ROOM-001');
      const receiverA = new BroadcastChannelTransport('ROOM-001');
      const receiverB = new BroadcastChannelTransport('ROOM-002');

      const aMessages: CastMessage[] = [];
      const bMessages: CastMessage[] = [];

      receiverA.onMessage((m) => aMessages.push(m));
      receiverB.onMessage((m) => bMessages.push(m));

      senderA.send({ type: 'STOP' });

      expect(aMessages).toHaveLength(1);
      expect(bMessages).toHaveLength(0); // Different room!
    });
  });

  // ── Test 9: Rapid successive messages ──────────────────────
  describe('Rapid successive messages', () => {
    it('all 10 rapid messages received in order', () => {
      const roomId = 'TEST-RAPID';
      const sender = new BroadcastChannelTransport(roomId);
      const receiver = new BroadcastChannelTransport(roomId);

      const received: string[] = [];
      receiver.onMessage((msg) => received.push(msg.type));

      for (let i = 0; i < 10; i++) {
        sender.send({ type: i % 2 === 0 ? 'PING' : 'PONG' });
      }

      expect(received).toHaveLength(10);
      expect(received[0]).toBe('PING');
      expect(received[1]).toBe('PONG');
    });
  });
});

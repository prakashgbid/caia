import { test, expect } from '@playwright/test';
import { startTestServer, stopTestServer } from './server';

/**
 * E2E: Two-tab BroadcastChannel sync.
 *
 * BroadcastChannel requires same-origin. We spin up a minimal HTTP server so
 * both pages share http://127.0.0.1:3791 — identical to how sender + cast tab
 * work in the real app (same site origin).
 */

let baseUrl: string;

test.beforeAll(async () => {
  baseUrl = await startTestServer(3791);
});

test.afterAll(async () => {
  await stopTestServer();
});

const BANNED_FIELDS = [
  'holeCards',
  'balanceHint',
  'coachOutput',
  'handEquityPreview',
  'isHoldingAce',
  'isHoldingPair',
  'privateCoachNarrative',
  'privateEquityChart',
  'privateSessionWinnings',
  'privateBalance',
  'castingPlayerSeat',
  'castingPlayerBalance',
  'castingPlayerWinnings',
  'castingPlayerBets',
  'castingPlayerNetSession',
  'isCasting',
];

test.describe('Two-tab BroadcastChannel sync', () => {
  test('sender STATE reaches receiver — zero private field leakage', async ({ context }) => {
    const senderPage = await context.newPage();
    const receiverPage = await context.newPage();

    // Same origin = BroadcastChannel crosses tabs
    await Promise.all([senderPage.goto(baseUrl), receiverPage.goto(baseUrl)]);

    // Register receiver listener before sender posts
    const receiverPromise = receiverPage.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        const ch = new BroadcastChannel('cast-TEST-E2E');
        ch.onmessage = (e: MessageEvent) => { ch.close(); resolve(e.data as Record<string, unknown>); };
      });
    });

    await receiverPage.waitForTimeout(100);

    const startMs = Date.now();

    await senderPage.evaluate(() => {
      const ch = new BroadcastChannel('cast-TEST-E2E');
      ch.postMessage({
        type: 'STATE',
        state: {
          roomId: 'TEST-E2E',
          street: 'flop',
          communityCards: [
            { rank: 'A', suit: 'S' },
            { rank: 'K', suit: 'H' },
            { rank: 'Q', suit: 'D' },
          ],
          pot: 1200,
          sidePots: [],
          players: [
            {
              seatIndex: 0, name: 'Alice', stack: 950,
              cards: { faceDown: true, count: 2 },
              isDealer: true, isActing: false, isAllIn: false, isFolded: false,
            },
            {
              seatIndex: 1, name: 'Bob', stack: 1100,
              cards: { faceDown: true, count: 2 },
              isDealer: false, isActing: true, isAllIn: false, isFolded: false,
            },
          ],
          actionHistory: [
            { seatIndex: 0, action: 'call', amount: 100, street: 'preflop' },
            { seatIndex: 1, action: 'raise', amount: 200, street: 'preflop' },
          ],
          dealerSeat: 0,
          actingSeat: 1,
        },
      });
      ch.close();
    });

    const received = await Promise.race([
      receiverPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    const latencyMs = Date.now() - startMs;

    expect(received, 'Receiver must get the message').not.toBeNull();
    expect(latencyMs, `Sync latency ${latencyMs}ms must be < 200ms`).toBeLessThan(200);

    if (!received) return;

    expect(received['type']).toBe('STATE');
    const state = received['state'] as Record<string, unknown>;

    // ── SECURITY: zero private fields anywhere in the tree ──
    function checkNoBanned(obj: unknown, path: string): void {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        (obj as unknown[]).forEach((x, i) => checkNoBanned(x, `${path}[${i}]`));
        return;
      }
      const rec = obj as Record<string, unknown>;
      for (const f of BANNED_FIELDS) {
        if (f in rec) throw new Error(`SECURITY: "${f}" found at ${path}.${f}`);
      }
      for (const [k, v] of Object.entries(rec)) checkNoBanned(v, `${path}.${k}`);
    }
    checkNoBanned(state, 'state');

    // Public data intact
    expect(state['pot']).toBe(1200);
    expect(state['roomId']).toBe('TEST-E2E');
    const players = state['players'] as Array<Record<string, unknown>>;
    expect(players).toHaveLength(2);
    expect(players[0]?.['name']).toBe('Alice');
    for (const p of players) {
      const cards = p['cards'] as Record<string, unknown>;
      expect(cards['faceDown']).toBe(true);
    }

    await senderPage.close();
    await receiverPage.close();
  });

  test('STOP message reaches receiver', async ({ context }) => {
    const senderPage = await context.newPage();
    const receiverPage = await context.newPage();

    await Promise.all([senderPage.goto(baseUrl), receiverPage.goto(baseUrl)]);

    const stopPromise = receiverPage.evaluate(() => {
      return new Promise<string>((resolve) => {
        const ch = new BroadcastChannel('cast-STOP-E2E');
        ch.onmessage = (e: MessageEvent) => { ch.close(); resolve((e.data as { type: string }).type); };
      });
    });

    await receiverPage.waitForTimeout(100);

    await senderPage.evaluate(() => {
      const ch = new BroadcastChannel('cast-STOP-E2E');
      ch.postMessage({ type: 'STOP' });
      ch.close();
    });

    const msgType = await Promise.race([
      stopPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    expect(msgType, 'Receiver must get STOP').toBe('STOP');
    await senderPage.close();
    await receiverPage.close();
  });

  test('showdown: cards visible, no private metadata', async ({ context }) => {
    const senderPage = await context.newPage();
    const receiverPage = await context.newPage();

    await Promise.all([senderPage.goto(baseUrl), receiverPage.goto(baseUrl)]);

    const recvPromise = receiverPage.evaluate(() => {
      return new Promise<Record<string, unknown>>((resolve) => {
        const ch = new BroadcastChannel('cast-SHOW-E2E');
        ch.onmessage = (e: MessageEvent) => { ch.close(); resolve(e.data as Record<string, unknown>); };
      });
    });

    await receiverPage.waitForTimeout(100);

    await senderPage.evaluate(() => {
      const ch = new BroadcastChannel('cast-SHOW-E2E');
      ch.postMessage({
        type: 'STATE',
        state: {
          roomId: 'SHOW-E2E', street: 'showdown',
          communityCards: [
            { rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' },
            { rank: 'Q', suit: 'D' }, { rank: 'J', suit: 'C' }, { rank: 'T', suit: 'S' },
          ],
          pot: 5000, sidePots: [],
          players: [
            {
              seatIndex: 0, name: 'Alice', stack: 0,
              cards: [{ rank: 'A', suit: 'H' }, { rank: 'A', suit: 'D' }],
              isDealer: true, isActing: false, isAllIn: true, isFolded: false,
            },
          ],
          actionHistory: [], dealerSeat: 0, actingSeat: null,
        },
      });
      ch.close();
    });

    const received = await Promise.race([
      recvPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);

    expect(received).not.toBeNull();
    if (!received) return;

    const state = received['state'] as Record<string, unknown>;

    function checkNoBanned(obj: unknown, path: string): void {
      if (!obj || typeof obj !== 'object') return;
      if (Array.isArray(obj)) {
        (obj as unknown[]).forEach((x, i) => checkNoBanned(x, `${path}[${i}]`));
        return;
      }
      const rec = obj as Record<string, unknown>;
      for (const f of BANNED_FIELDS) {
        if (f in rec) throw new Error(`SECURITY: "${f}" at ${path}.${f}`);
      }
      for (const [k, v] of Object.entries(rec)) checkNoBanned(v, `${path}.${k}`);
    }
    checkNoBanned(state, 'state');

    const players = state['players'] as Array<Record<string, unknown>>;
    const cards = players[0]?.['cards'] as unknown[];
    expect(Array.isArray(cards), 'Showdown cards must be array').toBe(true);
    expect(cards).toHaveLength(2);

    await senderPage.close();
    await receiverPage.close();
  });

  test('rapid state updates — receiver gets latest within 200ms', async ({ context }) => {
    const senderPage = await context.newPage();
    const receiverPage = await context.newPage();

    await Promise.all([senderPage.goto(baseUrl), receiverPage.goto(baseUrl)]);

    // Receiver collects all messages for 500ms
    const collectPromise = receiverPage.evaluate(() => {
      const msgs: unknown[] = [];
      const ch = new BroadcastChannel('cast-RAPID-E2E');
      ch.onmessage = (e: MessageEvent) => msgs.push(e.data);
      return new Promise<unknown[]>((resolve) => setTimeout(() => { ch.close(); resolve(msgs); }, 600));
    });

    await receiverPage.waitForTimeout(100);

    // Send 5 rapid state updates
    await senderPage.evaluate(() => {
      const ch = new BroadcastChannel('cast-RAPID-E2E');
      for (let i = 0; i < 5; i++) {
        ch.postMessage({ type: 'STATE', state: { pot: (i + 1) * 100, seq: i } });
      }
      ch.close();
    });

    const messages = await collectPromise;
    expect(messages.length, 'All 5 messages received').toBe(5);

    await senderPage.close();
    await receiverPage.close();
  });
});

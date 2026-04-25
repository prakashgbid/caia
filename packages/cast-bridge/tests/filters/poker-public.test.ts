import { describe, it, expect } from 'vitest';
import { toPublicPokerState } from '../../src/filters/poker-public';
import type {
  FullGameState,
  FullPlayer,
  Card,
  Street,
  PublicPokerState,
  FaceDownCards,
  PublicCard,
} from '../../src/filters/types';

// ============================================================
// Helper: recursively assert no private fields exist
// ============================================================
function assertNoPrivateFields(obj: unknown, path = 'root'): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoPrivateFields(item, `${path}[${i}]`));
    return;
  }
  const record = obj as Record<string, unknown>;
  const BANNED = [
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
    'isCasting',
  ];
  for (const key of BANNED) {
    if (key in record) {
      throw new Error(`Private field "${key}" found at ${path}.${key}`);
    }
  }
  // holeCards must NOT appear as raw Card[] — must be stripped to faceDown or cards[]
  if ('holeCards' in record) {
    throw new Error(`Raw holeCards found at ${path}.holeCards — must be stripped`);
  }
  // Recurse
  for (const [key, val] of Object.entries(record)) {
    assertNoPrivateFields(val, `${path}.${key}`);
  }
}

// ============================================================
// Factories
// ============================================================
const ACE_SPADES: Card = { rank: 'A', suit: 'S' };
const KING_HEARTS: Card = { rank: 'K', suit: 'H' };
const QUEEN_DIAMONDS: Card = { rank: 'Q', suit: 'D' };
const JACK_CLUBS: Card = { rank: 'J', suit: 'C' };
const TEN_SPADES: Card = { rank: 'T', suit: 'S' };
const TWO_CLUBS: Card = { rank: '2', suit: 'C' };
const SEVEN_HEARTS: Card = { rank: '7', suit: 'H' };
const NINE_DIAMONDS: Card = { rank: '9', suit: 'D' };

function makePlayer(overrides: Partial<FullPlayer> = {}): FullPlayer {
  return {
    seatIndex: 0,
    name: 'Alice',
    stack: 1000,
    holeCards: [ACE_SPADES, KING_HEARTS],
    isCasting: false,
    isDealer: false,
    isActing: false,
    isAllIn: false,
    isFolded: false,
    ...overrides,
  };
}

function makeState(overrides: Partial<FullGameState> = {}): FullGameState {
  return {
    roomId: 'ROOM-0001',
    street: 'preflop',
    communityCards: [],
    pot: 100,
    sidePots: [],
    players: [makePlayer({ seatIndex: 0 }), makePlayer({ seatIndex: 1, name: 'Bob' })],
    actionHistory: [],
    dealerSeat: 0,
    actingSeat: 1,
    ...overrides,
  };
}

function makeFullPlayer(seatIndex: number, name: string, overrides: Partial<FullPlayer> = {}): FullPlayer {
  return {
    seatIndex,
    name,
    stack: 1000,
    holeCards: [ACE_SPADES, KING_HEARTS],
    isCasting: false,
    isDealer: seatIndex === 0,
    isActing: false,
    isAllIn: false,
    isFolded: false,
    ...overrides,
  };
}

// ============================================================
// Random state generator for fuzz tests
// ============================================================
const SUITS = ['S', 'H', 'D', 'C'] as const;
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river', 'showdown'];

function randomCard(): Card {
  return {
    rank: RANKS[Math.floor(Math.random() * RANKS.length)] as Card['rank'],
    suit: SUITS[Math.floor(Math.random() * SUITS.length)] as Card['suit'],
  };
}

function randomPlayer(seatIndex: number): FullPlayer {
  return {
    seatIndex,
    name: `Player${seatIndex}`,
    stack: Math.floor(Math.random() * 10000),
    holeCards: Math.random() > 0.2 ? [randomCard(), randomCard()] : null,
    isCasting: Math.random() > 0.8,
    isDealer: seatIndex === 0,
    isActing: seatIndex === 1,
    isAllIn: Math.random() > 0.85,
    isFolded: Math.random() > 0.7,
    // Private fields injected
    balanceHint: 'secret-balance-$500',
    coachOutput: 'raise-preflop',
    handEquityPreview: Math.random(),
    isHoldingAce: Math.random() > 0.5,
    isHoldingPair: Math.random() > 0.5,
  };
}

function randomFullState(): FullGameState {
  const street = STREETS[Math.floor(Math.random() * STREETS.length)] as Street;
  const numCommunity = street === 'preflop' ? 0 : street === 'flop' ? 3 : street === 'turn' ? 4 : 5;
  const numPlayers = 2 + Math.floor(Math.random() * 7);

  return {
    roomId: `FUZZ-${Math.random().toString(36).slice(2, 8)}`,
    street,
    communityCards: Array.from({ length: numCommunity }, randomCard),
    pot: Math.floor(Math.random() * 5000),
    sidePots: Math.random() > 0.7
      ? [{ amount: Math.floor(Math.random() * 1000), eligibleSeats: [0, 1] }]
      : [],
    players: Array.from({ length: numPlayers }, (_, i) => randomPlayer(i)),
    actionHistory: [],
    dealerSeat: 0,
    actingSeat: Math.random() > 0.2 ? 1 : null,
    // All private fields
    castingPlayerSeat: 0,
    privateCoachNarrative: 'fold-now',
    privateEquityChart: [0.3, 0.7],
    privateSessionWinnings: 250,
    privateBalance: 5000,
  };
}

// ============================================================
// Test suite
// ============================================================

describe('toPublicPokerState — private field stripping', () => {
  // ── Scenario 1: Preflop 2 players ──────────────────────────
  describe('Scenario 1: Preflop — 2 players with hole cards', () => {
    it('strips holeCards from both players', () => {
      const state = makeState();
      const result = toPublicPokerState(state);
      assertNoPrivateFields(result);
    });

    it('players have faceDown cards with count=2', () => {
      const state = makeState();
      const result = toPublicPokerState(state);
      for (const p of result.players) {
        expect('faceDown' in p.cards).toBe(true);
        expect((p.cards as FaceDownCards).count).toBe(2);
      }
    });

    it('preserves roomId', () => {
      const state = makeState({ roomId: 'TEST-1234' });
      expect(toPublicPokerState(state).roomId).toBe('TEST-1234');
    });

    it('preserves street=preflop', () => {
      const result = toPublicPokerState(makeState({ street: 'preflop' }));
      expect(result.street).toBe('preflop');
    });

    it('preserves pot', () => {
      const result = toPublicPokerState(makeState({ pot: 999 }));
      expect(result.pot).toBe(999);
    });

    it('preserves actingSeat', () => {
      const result = toPublicPokerState(makeState({ actingSeat: 1 }));
      expect(result.actingSeat).toBe(1);
    });

    it('preserves dealerSeat', () => {
      const result = toPublicPokerState(makeState({ dealerSeat: 0 }));
      expect(result.dealerSeat).toBe(0);
    });

    it('player names are preserved', () => {
      const state = makeState();
      const result = toPublicPokerState(state);
      expect(result.players[0]?.name).toBe('Alice');
      expect(result.players[1]?.name).toBe('Bob');
    });

    it('player stacks are preserved', () => {
      const state = makeState({
        players: [
          makePlayer({ seatIndex: 0, stack: 2500 }),
          makePlayer({ seatIndex: 1, stack: 750, name: 'Bob' }),
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.players[0]?.stack).toBe(2500);
      expect(result.players[1]?.stack).toBe(750);
    });

    it('empty community cards at preflop', () => {
      const result = toPublicPokerState(makeState({ communityCards: [] }));
      expect(result.communityCards).toHaveLength(0);
    });
  });

  // ── Scenario 2: Preflop 6 players, some folded ─────────────
  describe('Scenario 2: Preflop — 6 players, some folded', () => {
    const players = [
      makeFullPlayer(0, 'Alice', { isFolded: true }),
      makeFullPlayer(1, 'Bob'),
      makeFullPlayer(2, 'Carol', { isFolded: true }),
      makeFullPlayer(3, 'Dave'),
      makeFullPlayer(4, 'Eve', { isFolded: true }),
      makeFullPlayer(5, 'Frank'),
    ];

    it('strips all hole cards even for folded players', () => {
      const state = makeState({ players, street: 'preflop' });
      const result = toPublicPokerState(state);
      assertNoPrivateFields(result);
    });

    it('isFolded flag preserved for all 6 players', () => {
      const state = makeState({ players, street: 'preflop' });
      const result = toPublicPokerState(state);
      expect(result.players[0]?.isFolded).toBe(true);
      expect(result.players[1]?.isFolded).toBe(false);
      expect(result.players[2]?.isFolded).toBe(true);
      expect(result.players[3]?.isFolded).toBe(false);
      expect(result.players[4]?.isFolded).toBe(true);
      expect(result.players[5]?.isFolded).toBe(false);
    });

    it('all 6 players present in output', () => {
      const state = makeState({ players, street: 'preflop' });
      expect(toPublicPokerState(state).players).toHaveLength(6);
    });
  });

  // ── Scenario 3: Flop 4 players ─────────────────────────────
  describe('Scenario 3: Flop — 4 players active', () => {
    it('preserves exactly 3 community cards', () => {
      const state = makeState({
        street: 'flop',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS],
        players: [0, 1, 2, 3].map((i) => makeFullPlayer(i, `P${i}`)),
      });
      const result = toPublicPokerState(state);
      expect(result.communityCards).toHaveLength(3);
    });

    it('community cards rank/suit preserved on flop', () => {
      const state = makeState({
        street: 'flop',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS],
      });
      const result = toPublicPokerState(state);
      expect(result.communityCards[0]).toEqual({ rank: 'A', suit: 'S' });
      expect(result.communityCards[1]).toEqual({ rank: 'K', suit: 'H' });
      expect(result.communityCards[2]).toEqual({ rank: 'Q', suit: 'D' });
    });

    it('strips private fields on flop', () => {
      const state = makeState({
        street: 'flop',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS],
        players: [0, 1, 2, 3].map((i) =>
          makeFullPlayer(i, `P${i}`, {
            balanceHint: 'SECRET',
            coachOutput: 'bluff',
            handEquityPreview: 0.55,
          })
        ),
        castingPlayerSeat: 0,
        privateCoachNarrative: 'raise',
        privateEquityChart: [0.4, 0.6],
        privateSessionWinnings: 100,
        privateBalance: 2000,
      });
      const result = toPublicPokerState(state);
      assertNoPrivateFields(result);
    });
  });

  // ── Scenario 4: Turn ───────────────────────────────────────
  describe('Scenario 4: Turn — 3 players active', () => {
    it('preserves 4 community cards on turn', () => {
      const state = makeState({
        street: 'turn',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS],
        players: [0, 1, 2].map((i) => makeFullPlayer(i, `P${i}`)),
      });
      expect(toPublicPokerState(state).communityCards).toHaveLength(4);
    });

    it('no private fields on turn', () => {
      const state = makeState({
        street: 'turn',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS],
      });
      assertNoPrivateFields(toPublicPokerState(state));
    });
  });

  // ── Scenario 5: River ──────────────────────────────────────
  describe('Scenario 5: River — 2 players active', () => {
    it('preserves 5 community cards on river', () => {
      const state = makeState({
        street: 'river',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES],
      });
      expect(toPublicPokerState(state).communityCards).toHaveLength(5);
    });

    it('cards still face-down on river (before showdown)', () => {
      const state = makeState({
        street: 'river',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES],
      });
      const result = toPublicPokerState(state);
      for (const p of result.players) {
        expect('faceDown' in p.cards).toBe(true);
      }
    });
  });

  // ── Scenario 6: Showdown ───────────────────────────────────
  describe('Scenario 6: Showdown — cards visible', () => {
    it('shows actual cards at showdown for non-null holeCards', () => {
      const state = makeState({
        street: 'showdown',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES],
        players: [
          makeFullPlayer(0, 'Alice', { holeCards: [ACE_SPADES, KING_HEARTS] }),
          makeFullPlayer(1, 'Bob', { holeCards: [TWO_CLUBS, SEVEN_HEARTS] }),
        ],
      });
      const result = toPublicPokerState(state);
      const alice = result.players[0];
      expect('faceDown' in (alice?.cards ?? {})).toBe(false);
      expect(Array.isArray(alice?.cards)).toBe(true);
    });

    it('showdown cards have correct rank/suit', () => {
      const state = makeState({
        street: 'showdown',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES],
        players: [
          makeFullPlayer(0, 'Alice', { holeCards: [{ rank: '9', suit: 'D' }, { rank: '8', suit: 'H' }] }),
          makeFullPlayer(1, 'Bob', { holeCards: [{ rank: '2', suit: 'C' }, { rank: '3', suit: 'S' }] }),
        ],
      });
      const result = toPublicPokerState(state);
      const aliceCards = result.players[0]?.cards as PublicCard[];
      expect(aliceCards[0]).toEqual({ rank: '9', suit: 'D' });
      expect(aliceCards[1]).toEqual({ rank: '8', suit: 'H' });
    });

    it('showdown with null holeCards still renders face-down', () => {
      const state = makeState({
        street: 'showdown',
        players: [
          makeFullPlayer(0, 'Alice', { holeCards: null }),
          makeFullPlayer(1, 'Bob', { holeCards: [TWO_CLUBS, SEVEN_HEARTS] }),
        ],
      });
      const result = toPublicPokerState(state);
      const alice = result.players[0];
      // null holeCards → face down (defaulting to count=2)
      expect('faceDown' in (alice?.cards ?? {})).toBe(true);
    });

    it('no private fields at showdown', () => {
      const state = makeState({
        street: 'showdown',
        players: [
          makeFullPlayer(0, 'Alice', {
            holeCards: [ACE_SPADES, KING_HEARTS],
            balanceHint: 'PRIVATE',
            coachOutput: 'PRIVATE',
            handEquityPreview: 0.9,
          }),
        ],
        castingPlayerSeat: 0,
        privateBalance: 1000,
      });
      assertNoPrivateFields(toPublicPokerState(state));
    });

    it('showdown cards cannot reveal private info through card objects', () => {
      const extendedCard = { rank: 'A' as const, suit: 'S' as const, secretValue: 'HACK' };
      const state = makeState({
        street: 'showdown',
        players: [
          makeFullPlayer(0, 'Alice', { holeCards: [extendedCard as Card, KING_HEARTS] }),
        ],
      });
      const result = toPublicPokerState(state);
      const cards = result.players[0]?.cards as PublicCard[];
      // Only rank and suit should be present
      expect(Object.keys(cards[0] ?? {})).toEqual(['rank', 'suit']);
    });
  });

  // ── Scenario 7: All-in with side pots ──────────────────────
  describe('Scenario 7: All-in with side pots', () => {
    it('preserves side pot amounts', () => {
      const state = makeState({
        pot: 3000,
        sidePots: [
          { amount: 1000, eligibleSeats: [0, 1, 2] },
          { amount: 2000, eligibleSeats: [1, 2] },
        ],
        players: [
          makeFullPlayer(0, 'Alice', { isAllIn: true, stack: 0 }),
          makeFullPlayer(1, 'Bob', { isAllIn: true, stack: 0 }),
          makeFullPlayer(2, 'Carol'),
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.sidePots).toHaveLength(2);
      expect(result.sidePots[0]?.amount).toBe(1000);
      expect(result.sidePots[1]?.amount).toBe(2000);
    });

    it('isAllIn flag preserved', () => {
      const state = makeState({
        players: [
          makeFullPlayer(0, 'Alice', { isAllIn: true }),
          makeFullPlayer(1, 'Bob', { isAllIn: false }),
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.players[0]?.isAllIn).toBe(true);
      expect(result.players[1]?.isAllIn).toBe(false);
    });

    it('no private fields with all-in side pot scenario', () => {
      const state = makeState({
        pot: 3000,
        sidePots: [{ amount: 1500, eligibleSeats: [0, 1] }],
        players: [
          makeFullPlayer(0, 'Alice', { isAllIn: true, balanceHint: 'HIDDEN' }),
          makeFullPlayer(1, 'Bob'),
        ],
        castingPlayerSeat: 0,
        privateBalance: 999,
      });
      assertNoPrivateFields(toPublicPokerState(state));
    });
  });

  // ── Scenario 8: Dealer rotation ────────────────────────────
  describe('Scenario 8: Dealer rotation — every seat', () => {
    const playerNames = ['Alice', 'Bob', 'Carol', 'Dave', 'Eve', 'Frank'];

    for (let dealerSeat = 0; dealerSeat < 6; dealerSeat++) {
      it(`dealer seat ${dealerSeat} is preserved in output`, () => {
        const state = makeState({
          dealerSeat,
          players: playerNames.map((name, i) =>
            makeFullPlayer(i, name, { isDealer: i === dealerSeat })
          ),
        });
        const result = toPublicPokerState(state);
        expect(result.dealerSeat).toBe(dealerSeat);
        expect(result.players[dealerSeat]?.isDealer).toBe(true);
      });
    }
  });

  // ── Scenario 9: All private fields on one player ───────────
  describe('Scenario 9: Player with all private fields populated', () => {
    it('strips all private fields from fully populated player', () => {
      const state = makeState({
        players: [
          {
            seatIndex: 0,
            name: 'Alice',
            stack: 1000,
            holeCards: [ACE_SPADES, KING_HEARTS],
            isCasting: true,
            isDealer: true,
            isActing: false,
            isAllIn: false,
            isFolded: false,
            balanceHint: '$1,234 total',
            coachOutput: 'RAISE 3x BB',
            handEquityPreview: 0.72,
            isHoldingAce: true,
            isHoldingPair: false,
          },
        ],
        castingPlayerSeat: 0,
        privateCoachNarrative: 'Tight aggressive recommended',
        privateEquityChart: [0.28, 0.72],
        privateSessionWinnings: 340,
        privateBalance: 2340,
      });
      const result = toPublicPokerState(state);
      assertNoPrivateFields(result);
    });

    it('public player has exactly the correct keys', () => {
      const state = makeState({
        street: 'preflop',
        players: [
          makeFullPlayer(0, 'Alice', {
            balanceHint: 'SECRET',
            coachOutput: 'SECRET',
            handEquityPreview: 0.5,
            isHoldingAce: true,
            isHoldingPair: true,
            isCasting: true,
          }),
        ],
      });
      const result = toPublicPokerState(state);
      const player = result.players[0];
      const keys = Object.keys(player ?? {}).sort();
      expect(keys).toEqual(
        ['cards', 'isActing', 'isAllIn', 'isDealer', 'isFolded', 'name', 'seatIndex', 'stack'].sort()
      );
    });
  });

  // ── Scenario 10: Undefined/null optional fields ─────────────
  describe('Scenario 10: Undefined/null optional fields', () => {
    it('actingSeat can be null', () => {
      const state = makeState({ actingSeat: null });
      expect(toPublicPokerState(state).actingSeat).toBeNull();
    });

    it('player with null holeCards — face-down with count 2', () => {
      const state = makeState({
        players: [makeFullPlayer(0, 'Alice', { holeCards: null })],
      });
      const result = toPublicPokerState(state);
      const p = result.players[0];
      expect((p?.cards as FaceDownCards).faceDown).toBe(true);
      expect((p?.cards as FaceDownCards).count).toBe(2);
    });

    it('sidePots empty array preserved', () => {
      const state = makeState({ sidePots: [] });
      expect(toPublicPokerState(state).sidePots).toHaveLength(0);
    });
  });

  // ── Scenario 11: Empty action history ──────────────────────
  describe('Scenario 11: Empty action history', () => {
    it('empty actionHistory preserved', () => {
      const state = makeState({ actionHistory: [] });
      expect(toPublicPokerState(state).actionHistory).toHaveLength(0);
    });
  });

  // ── Scenario 12: Full action history across all streets ─────
  describe('Scenario 12: Full action history across all streets', () => {
    it('all action records preserved in order', () => {
      const state = makeState({
        actionHistory: [
          { seatIndex: 0, action: 'call', street: 'preflop' },
          { seatIndex: 1, action: 'raise', amount: 50, street: 'preflop' },
          { seatIndex: 0, action: 'call', street: 'flop' },
          { seatIndex: 1, action: 'check', street: 'flop' },
          { seatIndex: 0, action: 'raise', amount: 100, street: 'turn' },
          { seatIndex: 1, action: 'fold', street: 'turn' },
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.actionHistory).toHaveLength(6);
      expect(result.actionHistory[1]?.amount).toBe(50);
      expect(result.actionHistory[4]?.amount).toBe(100);
    });

    it('action records do not contain extra private fields', () => {
      const state = makeState({
        actionHistory: [
          { seatIndex: 0, action: 'raise', amount: 200, street: 'preflop' },
        ],
      });
      const result = toPublicPokerState(state);
      const action = result.actionHistory[0];
      expect(Object.keys(action ?? {}).sort()).toEqual(
        ['action', 'amount', 'seatIndex', 'street'].sort()
      );
    });
  });

  // ── Scenario 13: Community cards — 0, 3, 4, 5 ──────────────
  describe('Scenario 13: Community card permutations', () => {
    it('0 community cards (preflop)', () => {
      expect(toPublicPokerState(makeState({ communityCards: [] })).communityCards).toHaveLength(0);
    });

    it('3 community cards (flop)', () => {
      const state = makeState({ street: 'flop', communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS] });
      expect(toPublicPokerState(state).communityCards).toHaveLength(3);
    });

    it('4 community cards (turn)', () => {
      const state = makeState({ street: 'turn', communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS] });
      expect(toPublicPokerState(state).communityCards).toHaveLength(4);
    });

    it('5 community cards (river/showdown)', () => {
      const state = makeState({
        street: 'river',
        communityCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS, TEN_SPADES],
      });
      expect(toPublicPokerState(state).communityCards).toHaveLength(5);
    });

    it('community cards only have rank and suit', () => {
      const extendedCard = { rank: 'A' as const, suit: 'S' as const, privateField: 'HIDDEN' };
      const state = makeState({ communityCards: [extendedCard as Card] });
      const result = toPublicPokerState(state);
      expect(Object.keys(result.communityCards[0] ?? {})).toEqual(['rank', 'suit']);
    });
  });

  // ── Scenario 14: Multiple side pots ────────────────────────
  describe('Scenario 14: Multiple side pots', () => {
    it('three side pots preserved', () => {
      const state = makeState({
        sidePots: [
          { amount: 500, eligibleSeats: [0, 1, 2, 3] },
          { amount: 1000, eligibleSeats: [1, 2, 3] },
          { amount: 2000, eligibleSeats: [2, 3] },
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.sidePots).toHaveLength(3);
      expect(result.sidePots[2]?.amount).toBe(2000);
      expect(result.sidePots[2]?.eligibleSeats).toEqual([2, 3]);
    });

    it('eligibleSeats are copied (not mutated by reference)', () => {
      const origSeats = [0, 1, 2];
      const state = makeState({
        sidePots: [{ amount: 500, eligibleSeats: origSeats }],
      });
      const result = toPublicPokerState(state);
      // Mutate original
      origSeats.push(3);
      expect(result.sidePots[0]?.eligibleSeats).toHaveLength(3);
    });
  });

  // ── Scenario 15: Single player remaining (all others folded) ─
  describe('Scenario 15: Single player remaining', () => {
    it('last player standing — others folded', () => {
      const players = [
        makeFullPlayer(0, 'Alice', { isFolded: true }),
        makeFullPlayer(1, 'Bob', { isFolded: true }),
        makeFullPlayer(2, 'Carol'),
      ];
      const state = makeState({ players });
      const result = toPublicPokerState(state);
      expect(result.players.filter((p) => !p.isFolded)).toHaveLength(1);
      assertNoPrivateFields(result);
    });
  });

  // ── Scenario 16: 9-player table ────────────────────────────
  describe('Scenario 16: 9-player table', () => {
    it('all 9 players output with no private fields', () => {
      const players = Array.from({ length: 9 }, (_, i) =>
        makeFullPlayer(i, `Seat${i}`, {
          balanceHint: 'PRIVATE',
          coachOutput: 'PRIVATE',
          handEquityPreview: Math.random(),
          isHoldingAce: true,
          isHoldingPair: false,
        })
      );
      const state = makeState({ players });
      const result = toPublicPokerState(state);
      expect(result.players).toHaveLength(9);
      assertNoPrivateFields(result);
    });

    it('seat indices 0-8 preserved for 9-player table', () => {
      const players = Array.from({ length: 9 }, (_, i) => makeFullPlayer(i, `Seat${i}`));
      const result = toPublicPokerState(makeState({ players }));
      result.players.forEach((p, i) => {
        expect(p.seatIndex).toBe(i);
      });
    });
  });

  // ── Scenario 17: Special character names ───────────────────
  describe('Scenario 17: Player names with special characters', () => {
    it('unicode names preserved', () => {
      const state = makeState({
        players: [
          makeFullPlayer(0, '玩家一'),
          makeFullPlayer(1, 'Ñoño'),
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.players[0]?.name).toBe('玩家一');
      expect(result.players[1]?.name).toBe('Ñoño');
    });

    it('emoji names preserved', () => {
      const state = makeState({
        players: [makeFullPlayer(0, 'Player🃏')],
      });
      expect(toPublicPokerState(state).players[0]?.name).toBe('Player🃏');
    });
  });

  // ── Scenario 18: Zero stack ─────────────────────────────────
  describe('Scenario 18: Zero stack (bust)', () => {
    it('stack of 0 preserved', () => {
      const state = makeState({
        players: [makeFullPlayer(0, 'Alice', { stack: 0 })],
      });
      expect(toPublicPokerState(state).players[0]?.stack).toBe(0);
    });
  });

  // ── Scenario 19: Very large stacks ─────────────────────────
  describe('Scenario 19: Very large stacks', () => {
    it('stack of 1,000,000 preserved', () => {
      const state = makeState({
        players: [makeFullPlayer(0, 'Whale', { stack: 1_000_000 })],
      });
      expect(toPublicPokerState(state).players[0]?.stack).toBe(1_000_000);
    });

    it('pot of 500,000 preserved', () => {
      const state = makeState({ pot: 500_000 });
      expect(toPublicPokerState(state).pot).toBe(500_000);
    });
  });

  // ── Scenario 20: Mixed — folded, all-in, active ─────────────
  describe('Scenario 20: Mixed player states', () => {
    it('mixed fold/allin/active players all stripped', () => {
      const state = makeState({
        players: [
          makeFullPlayer(0, 'A', { isFolded: true, balanceHint: 'X' }),
          makeFullPlayer(1, 'B', { isAllIn: true, coachOutput: 'Y' }),
          makeFullPlayer(2, 'C', { isActing: true, handEquityPreview: 0.5 }),
          makeFullPlayer(3, 'D', { isFolded: false, isHoldingAce: true }),
        ],
        castingPlayerSeat: 2,
        privateSessionWinnings: 100,
      });
      assertNoPrivateFields(toPublicPokerState(state));
    });

    it('isActing flag preserved for active player', () => {
      const state = makeState({
        players: [
          makeFullPlayer(0, 'A', { isActing: false }),
          makeFullPlayer(1, 'B', { isActing: true }),
        ],
      });
      const result = toPublicPokerState(state);
      expect(result.players[0]?.isActing).toBe(false);
      expect(result.players[1]?.isActing).toBe(true);
    });
  });

  // ── Top-level private fields on FullGameState ───────────────
  describe('Top-level FullGameState private fields', () => {
    it('castingPlayerSeat not in output', () => {
      const state = makeState({ castingPlayerSeat: 3 });
      const result = toPublicPokerState(state) as unknown as Record<string, unknown>;
      expect('castingPlayerSeat' in result).toBe(false);
    });

    it('privateCoachNarrative not in output', () => {
      const state = makeState({ privateCoachNarrative: 'fold-everything' });
      const result = toPublicPokerState(state) as unknown as Record<string, unknown>;
      expect('privateCoachNarrative' in result).toBe(false);
    });

    it('privateEquityChart not in output', () => {
      const state = makeState({ privateEquityChart: [0.3, 0.7] });
      const result = toPublicPokerState(state) as unknown as Record<string, unknown>;
      expect('privateEquityChart' in result).toBe(false);
    });

    it('privateSessionWinnings not in output', () => {
      const state = makeState({ privateSessionWinnings: 1234 });
      const result = toPublicPokerState(state) as unknown as Record<string, unknown>;
      expect('privateSessionWinnings' in result).toBe(false);
    });

    it('privateBalance not in output', () => {
      const state = makeState({ privateBalance: 99999 });
      const result = toPublicPokerState(state) as unknown as Record<string, unknown>;
      expect('privateBalance' in result).toBe(false);
    });
  });

  // ── Output structure shape ──────────────────────────────────
  describe('PublicPokerState output shape', () => {
    it('result has exactly the expected top-level keys', () => {
      const result = toPublicPokerState(makeState());
      const keys = Object.keys(result).sort();
      expect(keys).toEqual(
        [
          'actionHistory',
          'actingSeat',
          'communityCards',
          'dealerSeat',
          'players',
          'pot',
          'roomId',
          'sidePots',
          'street',
        ].sort()
      );
    });
  });

  // ── Immutability / no mutation ──────────────────────────────
  describe('Immutability — original state not mutated', () => {
    it('mutating result does not affect original state', () => {
      const state = makeState({ pot: 500 });
      const result = toPublicPokerState(state);
      (result as unknown as Record<string, unknown>)['pot'] = 9999;
      expect(state.pot).toBe(500);
    });

    it('mutating result players does not affect original', () => {
      const state = makeState();
      const result = toPublicPokerState(state);
      result.players.push({
        seatIndex: 99,
        name: 'INJECTED',
        stack: 0,
        cards: { faceDown: true, count: 2 },
        isDealer: false,
        isActing: false,
        isAllIn: false,
        isFolded: false,
      });
      expect(state.players).toHaveLength(2);
    });
  });

  // ── Fuzz tests ─────────────────────────────────────────────
  describe('Fuzz: 20 random FullGameState objects', () => {
    for (let i = 0; i < 20; i++) {
      it(`fuzz run #${i + 1} — no private fields in output`, () => {
        const state = randomFullState();
        const result = toPublicPokerState(state);
        assertNoPrivateFields(result);
      });
    }
  });

  // ── Hole cards count passthrough ───────────────────────────
  describe('Hole card count passthrough', () => {
    it('holeCards with 1 card (edge) → faceDown count=1', () => {
      const state = makeState({
        players: [makeFullPlayer(0, 'Alice', { holeCards: [ACE_SPADES] })],
      });
      const result = toPublicPokerState(state);
      const p = result.players[0];
      expect((p?.cards as FaceDownCards).count).toBe(1);
    });

    it('holeCards with 4 cards (crazy game) → faceDown count=4', () => {
      const state = makeState({
        players: [
          makeFullPlayer(0, 'Alice', {
            holeCards: [ACE_SPADES, KING_HEARTS, QUEEN_DIAMONDS, JACK_CLUBS],
          }),
        ],
      });
      const result = toPublicPokerState(state);
      expect((result.players[0]?.cards as FaceDownCards).count).toBe(4);
    });
  });

  // ── actionHistory amount optional ──────────────────────────
  describe('Action history — optional amount field', () => {
    it('fold action has no amount', () => {
      const state = makeState({
        actionHistory: [{ seatIndex: 0, action: 'fold', street: 'preflop' }],
      });
      const result = toPublicPokerState(state);
      expect(result.actionHistory[0]?.amount).toBeUndefined();
    });

    it('raise action preserves amount', () => {
      const state = makeState({
        actionHistory: [{ seatIndex: 0, action: 'raise', amount: 300, street: 'flop' }],
      });
      const result = toPublicPokerState(state);
      expect(result.actionHistory[0]?.amount).toBe(300);
    });
  });
});

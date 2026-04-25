import { describe, it, expect } from 'vitest';
import { toPublicRouletteState } from '../../src/filters/roulette-public';
import type { FullRouletteState, PublicRouletteState, RouletteBet } from '../../src/filters/types';

// ============================================================
// Helper: recursively assert no private roulette fields
// ============================================================
function assertNoPrivateRouletteFields(obj: unknown, path = 'root'): void {
  if (obj === null || obj === undefined) return;
  if (typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => assertNoPrivateRouletteFields(item, `${path}[${i}]`));
    return;
  }
  const record = obj as Record<string, unknown>;
  const BANNED = [
    'castingPlayerBalance',
    'castingPlayerWinnings',
    'castingPlayerBets',
    'castingPlayerNetSession',
  ];
  for (const key of BANNED) {
    if (key in record) {
      throw new Error(`Private field "${key}" found at ${path}.${key}`);
    }
  }
  for (const [key, val] of Object.entries(record)) {
    assertNoPrivateRouletteFields(val, `${path}.${key}`);
  }
}

// ============================================================
// Factory
// ============================================================
function makeRouletteBet(overrides: Partial<RouletteBet> = {}): RouletteBet {
  return {
    type: 'straight',
    amount: 100,
    numbers: [7],
    ...overrides,
  };
}

function makeRouletteState(overrides: Partial<FullRouletteState> = {}): FullRouletteState {
  return {
    roomId: 'ROULETTE-001',
    phase: 'betting',
    wheelNumber: null,
    wheelColor: null,
    spinHistory: [],
    tableBets: [],
    totalPot: 0,
    ...overrides,
  };
}

// ============================================================
// Tests
// ============================================================
describe('toPublicRouletteState — private field stripping', () => {
  // ── Scenario 1: Betting phase with bets ─────────────────────
  describe('Scenario 1: Betting phase with bets', () => {
    it('strips all casting player private fields', () => {
      const state = makeRouletteState({
        phase: 'betting',
        tableBets: [
          { seatIndex: 0, bet: makeRouletteBet({ type: 'red-black', numbers: [1, 3, 5], amount: 50 }) },
          { seatIndex: 1, bet: makeRouletteBet({ type: 'dozen', numbers: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], amount: 100 }) },
        ],
        castingPlayerBalance: 5000,
        castingPlayerWinnings: 250,
        castingPlayerBets: [makeRouletteBet({ amount: 200 })],
        castingPlayerNetSession: 150,
      });
      const result = toPublicRouletteState(state);
      assertNoPrivateRouletteFields(result);
    });

    it('table bets are preserved (they are public)', () => {
      const state = makeRouletteState({
        tableBets: [
          { seatIndex: 0, bet: makeRouletteBet({ type: 'straight', numbers: [7], amount: 100 }) },
          { seatIndex: 1, bet: makeRouletteBet({ type: 'split', numbers: [14, 15], amount: 50 }) },
        ],
      });
      const result = toPublicRouletteState(state);
      expect(result.tableBets).toHaveLength(2);
      expect(result.tableBets[0]?.bet.type).toBe('straight');
      expect(result.tableBets[1]?.bet.type).toBe('split');
    });

    it('table bet amounts preserved', () => {
      const state = makeRouletteState({
        tableBets: [{ seatIndex: 0, bet: makeRouletteBet({ amount: 750 }) }],
      });
      expect(toPublicRouletteState(state).tableBets[0]?.bet.amount).toBe(750);
    });

    it('table bet numbers preserved', () => {
      const state = makeRouletteState({
        tableBets: [{ seatIndex: 0, bet: makeRouletteBet({ numbers: [1, 2, 3], type: 'street' }) }],
      });
      expect(toPublicRouletteState(state).tableBets[0]?.bet.numbers).toEqual([1, 2, 3]);
    });

    it('totalPot preserved in betting phase', () => {
      const state = makeRouletteState({ phase: 'betting', totalPot: 1500 });
      expect(toPublicRouletteState(state).totalPot).toBe(1500);
    });

    it('phase=betting preserved', () => {
      const state = makeRouletteState({ phase: 'betting' });
      expect(toPublicRouletteState(state).phase).toBe('betting');
    });

    it('roomId preserved', () => {
      const state = makeRouletteState({ roomId: 'MY-ROOM' });
      expect(toPublicRouletteState(state).roomId).toBe('MY-ROOM');
    });
  });

  // ── Scenario 2: Spinning phase ──────────────────────────────
  describe('Scenario 2: Spinning phase', () => {
    it('phase=spinning preserved', () => {
      const state = makeRouletteState({ phase: 'spinning' });
      expect(toPublicRouletteState(state).phase).toBe('spinning');
    });

    it('wheelNumber null during spinning', () => {
      const state = makeRouletteState({ phase: 'spinning', wheelNumber: null });
      expect(toPublicRouletteState(state).wheelNumber).toBeNull();
    });

    it('no private fields in spinning phase', () => {
      const state = makeRouletteState({
        phase: 'spinning',
        castingPlayerBalance: 3000,
        castingPlayerWinnings: 500,
      });
      assertNoPrivateRouletteFields(toPublicRouletteState(state));
    });
  });

  // ── Scenario 3: Result phase with wheel number ──────────────
  describe('Scenario 3: Result phase with wheel number', () => {
    it('phase=result preserved', () => {
      const state = makeRouletteState({ phase: 'result', wheelNumber: 17, wheelColor: 'black' });
      expect(toPublicRouletteState(state).phase).toBe('result');
    });

    it('wheelNumber preserved in result phase', () => {
      const state = makeRouletteState({ phase: 'result', wheelNumber: 32, wheelColor: 'red' });
      expect(toPublicRouletteState(state).wheelNumber).toBe(32);
    });

    it('wheelColor preserved — red', () => {
      const state = makeRouletteState({ phase: 'result', wheelNumber: 7, wheelColor: 'red' });
      expect(toPublicRouletteState(state).wheelColor).toBe('red');
    });

    it('wheelColor preserved — black', () => {
      const state = makeRouletteState({ phase: 'result', wheelNumber: 17, wheelColor: 'black' });
      expect(toPublicRouletteState(state).wheelColor).toBe('black');
    });

    it('wheelColor preserved — green (zero)', () => {
      const state = makeRouletteState({ phase: 'result', wheelNumber: 0, wheelColor: 'green' });
      expect(toPublicRouletteState(state).wheelColor).toBe('green');
    });

    it('no private fields in result phase', () => {
      const state = makeRouletteState({
        phase: 'result',
        wheelNumber: 17,
        wheelColor: 'black',
        castingPlayerBalance: 1000,
        castingPlayerWinnings: -50,
        castingPlayerNetSession: -50,
      });
      assertNoPrivateRouletteFields(toPublicRouletteState(state));
    });

    it('wheelNumber=0 (green) preserved', () => {
      const state = makeRouletteState({ phase: 'result', wheelNumber: 0, wheelColor: 'green' });
      expect(toPublicRouletteState(state).wheelNumber).toBe(0);
    });
  });

  // ── Scenario 4: Idle phase ──────────────────────────────────
  describe('Scenario 4: Idle phase', () => {
    it('phase=idle preserved', () => {
      const state = makeRouletteState({ phase: 'idle' });
      expect(toPublicRouletteState(state).phase).toBe('idle');
    });

    it('idle phase with null wheel data', () => {
      const state = makeRouletteState({ phase: 'idle', wheelNumber: null, wheelColor: null });
      const result = toPublicRouletteState(state);
      expect(result.wheelNumber).toBeNull();
      expect(result.wheelColor).toBeNull();
    });

    it('no private fields in idle phase', () => {
      const state = makeRouletteState({
        phase: 'idle',
        castingPlayerBalance: 2000,
        castingPlayerNetSession: 0,
      });
      assertNoPrivateRouletteFields(toPublicRouletteState(state));
    });
  });

  // ── Scenario 5: Spin history preserved ─────────────────────
  describe('Scenario 5: Spin history preserved', () => {
    it('spin history preserved with all entries', () => {
      const state = makeRouletteState({
        spinHistory: [
          { number: 7, color: 'red' },
          { number: 17, color: 'black' },
          { number: 0, color: 'green' },
          { number: 32, color: 'red' },
        ],
      });
      const result = toPublicRouletteState(state);
      expect(result.spinHistory).toHaveLength(4);
      expect(result.spinHistory[2]).toEqual({ number: 0, color: 'green' });
    });

    it('spin history copy does not mutate original', () => {
      const history = [{ number: 7, color: 'red' as const }];
      const state = makeRouletteState({ spinHistory: history });
      const result = toPublicRouletteState(state);
      history.push({ number: 14, color: 'red' as const });
      expect(result.spinHistory).toHaveLength(1);
    });

    it('empty spin history preserved', () => {
      const state = makeRouletteState({ spinHistory: [] });
      expect(toPublicRouletteState(state).spinHistory).toHaveLength(0);
    });
  });

  // ── Scenario 6: Output shape ────────────────────────────────
  describe('Output shape validation', () => {
    it('result has exactly the expected top-level keys', () => {
      const result = toPublicRouletteState(makeRouletteState());
      const keys = Object.keys(result).sort();
      expect(keys).toEqual(
        ['phase', 'roomId', 'spinHistory', 'tableBets', 'totalPot', 'wheelColor', 'wheelNumber'].sort()
      );
    });

    it('castingPlayerBalance NOT in output', () => {
      const state = makeRouletteState({ castingPlayerBalance: 9999 });
      const result = toPublicRouletteState(state) as unknown as Record<string, unknown>;
      expect('castingPlayerBalance' in result).toBe(false);
    });

    it('castingPlayerWinnings NOT in output', () => {
      const state = makeRouletteState({ castingPlayerWinnings: 500 });
      const result = toPublicRouletteState(state) as unknown as Record<string, unknown>;
      expect('castingPlayerWinnings' in result).toBe(false);
    });

    it('castingPlayerBets NOT in output', () => {
      const state = makeRouletteState({
        castingPlayerBets: [makeRouletteBet()],
      });
      const result = toPublicRouletteState(state) as unknown as Record<string, unknown>;
      expect('castingPlayerBets' in result).toBe(false);
    });

    it('castingPlayerNetSession NOT in output', () => {
      const state = makeRouletteState({ castingPlayerNetSession: -150 });
      const result = toPublicRouletteState(state) as unknown as Record<string, unknown>;
      expect('castingPlayerNetSession' in result).toBe(false);
    });
  });

  // ── Bet types preserved ─────────────────────────────────────
  describe('All bet types preserved', () => {
    const betTypes = ['straight', 'split', 'street', 'corner', 'dozen', 'column', 'red-black', 'odd-even', 'high-low'] as const;

    for (const betType of betTypes) {
      it(`bet type "${betType}" preserved`, () => {
        const state = makeRouletteState({
          tableBets: [{ seatIndex: 0, bet: makeRouletteBet({ type: betType }) }],
        });
        expect(toPublicRouletteState(state).tableBets[0]?.bet.type).toBe(betType);
      });
    }
  });

  // ── Immutability ────────────────────────────────────────────
  describe('Immutability', () => {
    it('mutating result.tableBets does not affect original', () => {
      const state = makeRouletteState({
        tableBets: [{ seatIndex: 0, bet: makeRouletteBet() }],
      });
      const result = toPublicRouletteState(state);
      result.tableBets.push({ seatIndex: 99, bet: makeRouletteBet({ amount: 9999 }) });
      expect(state.tableBets).toHaveLength(1);
    });

    it('mutating bet numbers in result does not affect original', () => {
      const origNumbers = [1, 2, 3];
      const state = makeRouletteState({
        tableBets: [{ seatIndex: 0, bet: makeRouletteBet({ numbers: origNumbers }) }],
      });
      const result = toPublicRouletteState(state);
      (result.tableBets[0]?.bet.numbers as number[]).push(99);
      expect(origNumbers).toHaveLength(3);
    });
  });
});

import type { FullRouletteState, PublicRouletteState } from './types';

export function toPublicRouletteState(s: FullRouletteState): PublicRouletteState {
  return {
    roomId: s.roomId,
    phase: s.phase,
    wheelNumber: s.wheelNumber,
    wheelColor: s.wheelColor,
    spinHistory: s.spinHistory.map((h) => ({ number: h.number, color: h.color })),
    tableBets: s.tableBets.map((b) => ({
      seatIndex: b.seatIndex,
      bet: {
        type: b.bet.type,
        amount: b.bet.amount,
        numbers: [...b.bet.numbers],
      },
    })),
    totalPot: s.totalPot,
  };
}

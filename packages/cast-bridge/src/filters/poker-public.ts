import type {
  FullGameState,
  PublicPokerState,
  PublicPlayer,
  FullPlayer,
  PublicCard,
  FaceDownCards,
  ActionRecord,
} from './types';

export function toPublicPokerState(s: FullGameState): PublicPokerState {
  return {
    roomId: s.roomId,
    street: s.street,
    communityCards: s.communityCards.map((c): PublicCard => ({ rank: c.rank, suit: c.suit })),
    pot: s.pot,
    sidePots: s.sidePots.map((sp) => ({
      amount: sp.amount,
      eligibleSeats: [...sp.eligibleSeats],
    })),
    players: s.players.map((p) => toPublicPlayer(p, s.street)),
    actionHistory: s.actionHistory.map((a): ActionRecord => ({ ...a })),
    dealerSeat: s.dealerSeat,
    actingSeat: s.actingSeat,
  };
}

function toPublicPlayer(p: FullPlayer, street: FullGameState['street']): PublicPlayer {
  const base = {
    seatIndex: p.seatIndex,
    name: p.name,
    stack: p.stack,
    isDealer: p.isDealer,
    isActing: p.isActing,
    isAllIn: p.isAllIn,
    isFolded: p.isFolded,
  };

  if (street === 'showdown' && p.holeCards !== null && p.holeCards.length > 0) {
    return {
      ...base,
      cards: p.holeCards.map((c): PublicCard => ({ rank: c.rank, suit: c.suit })),
    };
  }

  const faceDown: FaceDownCards = { faceDown: true, count: p.holeCards?.length ?? 2 };
  return { ...base, cards: faceDown };
}

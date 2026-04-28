// ============================================================
// Full game state types (what the sender has)
// ============================================================

export type Suit = 'S' | 'H' | 'D' | 'C';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  rank: Rank;
  suit: Suit;
}

export type PlayerAction = 'fold' | 'check' | 'call' | 'raise' | 'all-in';

export interface ActionRecord {
  seatIndex: number;
  action: PlayerAction;
  amount?: number;
  street: 'preflop' | 'flop' | 'turn' | 'river';
}

export interface FullPlayer {
  seatIndex: number;
  name: string;
  stack: number;
  holeCards: Card[] | null;   // private — must be stripped
  isCasting: boolean;
  isDealer: boolean;
  isActing: boolean;
  isAllIn: boolean;
  isFolded: boolean;
  // Private fields
  balanceHint?: string;
  coachOutput?: string;
  handEquityPreview?: number;
  isHoldingAce?: boolean;
  isHoldingPair?: boolean;
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';

export interface FullGameState {
  roomId: string;
  street: Street;
  communityCards: Card[];
  pot: number;
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>;
  players: FullPlayer[];
  actionHistory: ActionRecord[];
  dealerSeat: number;
  actingSeat: number | null;
  // Private
  castingPlayerSeat?: number;
  privateCoachNarrative?: string;
  privateEquityChart?: number[];
  privateSessionWinnings?: number;
  privateBalance?: number;
}

// ============================================================
// Public state types (what the receiver / TV gets)
// ============================================================

export interface PublicCard {
  rank: Rank;
  suit: Suit;
}

export interface FaceDownCards {
  faceDown: true;
  count: number;
}

export interface ShowdownPlayer {
  seatIndex: number;
  name: string;
  stack: number;
  cards: PublicCard[];
  isDealer: boolean;
  isActing: boolean;
  isAllIn: boolean;
  isFolded: boolean;
}

export interface ActivePlayer {
  seatIndex: number;
  name: string;
  stack: number;
  cards: FaceDownCards;
  isDealer: boolean;
  isActing: boolean;
  isAllIn: boolean;
  isFolded: boolean;
}

export type PublicPlayer = ActivePlayer | ShowdownPlayer;

export interface PublicPokerState {
  roomId: string;
  street: Street;
  communityCards: PublicCard[];
  pot: number;
  sidePots: Array<{ amount: number; eligibleSeats: number[] }>;
  players: PublicPlayer[];
  actionHistory: ActionRecord[];
  dealerSeat: number;
  actingSeat: number | null;
}

// ============================================================
// Roulette types
// ============================================================

export type RouletteColor = 'red' | 'black' | 'green';
export type BetType = 'straight' | 'split' | 'street' | 'corner' | 'dozen' | 'column' | 'red-black' | 'odd-even' | 'high-low';

export interface RouletteBet {
  type: BetType;
  amount: number;
  numbers: number[];
}

export interface FullRouletteState {
  roomId: string;
  phase: 'betting' | 'spinning' | 'result' | 'idle';
  wheelNumber: number | null;
  wheelColor: RouletteColor | null;
  spinHistory: Array<{ number: number; color: RouletteColor }>;
  tableBets: Array<{
    seatIndex: number;
    bet: RouletteBet;
  }>;
  // Private — must be stripped
  castingPlayerBalance?: number;
  castingPlayerWinnings?: number;
  castingPlayerBets?: RouletteBet[];
  castingPlayerNetSession?: number;
  totalPot: number;
}

export interface PublicRouletteState {
  roomId: string;
  phase: 'betting' | 'spinning' | 'result' | 'idle';
  wheelNumber: number | null;
  wheelColor: RouletteColor | null;
  spinHistory: Array<{ number: number; color: RouletteColor }>;
  tableBets: Array<{
    seatIndex: number;
    bet: RouletteBet;
  }>;
  totalPot: number;
}

// ============================================================
// Transport interface
// ============================================================

export type CastMessage =
  | { type: 'STATE'; state: PublicPokerState | PublicRouletteState }
  | { type: 'STOP' }
  | { type: 'PING' }
  | { type: 'PONG' };

export interface Transport {
  send(message: CastMessage): void;
  onMessage(handler: (message: CastMessage) => void): () => void;
  close(): void;
}

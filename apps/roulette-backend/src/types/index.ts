// User types
export interface IUser {
  _id: string;
  email: string;
  username?: string;
  bankroll: number;
  role: 'user' | 'admin';
  createdAt: Date;
  lastLogin?: Date;
}

// Bet types
export type BetType = 
  | 'straight' 
  | 'split' 
  | 'street' 
  | 'corner' 
  | 'five' 
  | 'line' 
  | 'dozen' 
  | 'column' 
  | 'red' 
  | 'black' 
  | 'odd' 
  | 'even' 
  | 'low' 
  | 'high';

export interface IBet {
  _id: string;
  user: string;
  type: BetType;
  numbers: number[];
  amount: number;
  winningNumber?: number;
  payout: number;
  playId: string;
  createdAt: Date;
}

// Game types
export interface IGameStatistics {
  hotNumbers: number[];
  coldNumbers: number[];
  redBlackRatio: number;
  oddEvenRatio: number;
  highLowRatio: number;
}

export interface IGame {
  _id: string;
  user: string;
  history: number[];
  bankrollStart: number;
  bankrollEnd?: number;
  startTime: Date;
  endTime?: Date;
  status: 'active' | 'completed' | 'abandoned';
  statistics: IGameStatistics;
}

// Response types
export interface ApiResponse<T> {
  status: 'success' | 'fail' | 'error';
  message?: string;
  data?: T;
  token?: string;
  results?: number;
  pagination?: {
    page: number;
    limit: number;
    totalPages: number;
  };
}

// Request types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  username: string;
}

export interface UpdateProfileRequest {
  email?: string;
  username?: string;
}

export interface UpdatePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface CreateBetRequest {
  bets: Array<{
    type: BetType;
    numbers: number[];
    amount: number;
  }>;
  gameId?: string;
  winningNumber: number;
} 
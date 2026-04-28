/**
 * @file rouletteSlice.ts
 * @description Redux slice for the roulette game logic and state management
 * 
 * This file defines the core game logic for the roulette application, including:
 * - Game state structure and initial values
 * - Betting operations (add, remove, clear)
 * - Wheel spinning and result processing
 * - Payout calculations for different bet types
 * - Statistical tracking and analysis
 * - Game recommendations based on historical data
 * 
 * The roulette implementation follows European roulette rules with 
 * standard betting types and payout ratios.
 */

import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { v4 as uuidv4 } from 'uuid';

/**
 * All possible bet types in roulette
 * 
 * - straight: Bet on a single number (pays 35:1)
 * - split: Bet on two adjacent numbers (pays 17:1)
 * - street: Bet on three numbers in a row (pays 11:1)
 * - corner: Bet on four numbers that form a square (pays 8:1)
 * - five: Bet on five specific numbers: 0,00,1,2,3 (pays 6:1)
 * - line: Bet on six numbers that form two adjacent rows (pays 5:1)
 * - dozen: Bet on 12 numbers (1-12, 13-24, or 25-36) (pays 2:1)
 * - column: Bet on 12 numbers in a vertical column (pays 2:1)
 * - red/black: Bet on the color (pays 1:1)
 * - odd/even: Bet on whether the number is odd or even (pays 1:1)
 * - low/high: Bet on numbers 1-18 or 19-36 (pays 1:1)
 */
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

/**
 * Represents an active bet placed by the player
 * 
 * @property {string} id - Unique identifier for the bet
 * @property {BetType} type - Type of bet (straight, split, etc.)
 * @property {number[]} numbers - Array of numbers covered by this bet
 * @property {number} amount - Amount of money wagered
 */
export interface Bet {
  id: string;
  type: BetType;
  numbers: number[];
  amount: number;
}

/**
 * Represents the outcome of a bet after a wheel spin
 * 
 * @property {string} id - Unique identifier for the bet
 * @property {BetType} type - Type of bet (straight, split, etc.)
 * @property {number[]} numbers - Array of numbers covered by this bet
 * @property {number} amount - Amount of money wagered
 * @property {number} winningNumber - The number that came up on the wheel
 * @property {number} payout - Net amount won or lost (negative means loss)
 * @property {number} timestamp - When the bet was resolved (milliseconds)
 */
export interface BetResult {
  id: string;
  type: BetType;
  numbers: number[];
  amount: number;
  winningNumber: number;
  payout: number;
  timestamp: number;
}

/**
 * Complete state for the roulette game
 * 
 * @property {number[]} history - History of winning numbers
 * @property {Bet[]} bets - Currently active bets
 * @property {number} bankroll - Player's current balance
 * @property {number} selectedChip - Currently selected chip value
 * @property {string[]} recommendations - AI-generated betting advice
 * @property {BetResult[]} betHistory - History of previous bets and outcomes
 * @property {Object} statistics - Statistical analysis of game outcomes
 */
export interface RouletteState {
  history: number[];
  bets: Bet[];
  bankroll: number;
  selectedChip: number;
  recommendations: string[];
  betHistory: BetResult[];
  statistics: {
    hotNumbers: number[];    // Numbers that appear most frequently
    coldNumbers: number[];   // Numbers that appear least frequently
    redBlackRatio: number;   // Ratio of red to black outcomes
    oddEvenRatio: number;    // Ratio of odd to even outcomes
    highLowRatio: number;    // Ratio of high (19-36) to low (1-18) outcomes
  };
}

/**
 * Initial state for the roulette game
 * Sets up a new game with default values
 */
const initialState: RouletteState = {
  history: [],
  bets: [],
  bankroll: 1000,           // Starting balance of $1000
  selectedChip: 5,          // Default chip value of $5
  recommendations: [],
  betHistory: [],
  statistics: {
    hotNumbers: [],
    coldNumbers: [],
    redBlackRatio: 0,
    oddEvenRatio: 0,
    highLowRatio: 0,
  },
};

/**
 * Redux slice for roulette game state
 * Defines reducers for all game actions
 */
export const rouletteSlice = createSlice({
  name: 'roulette',
  initialState,
  reducers: {
    /**
     * Places a new bet on the table
     * Deducts the bet amount from bankroll
     * 
     * @param {RouletteState} state - Current game state
     * @param {PayloadAction<Omit<Bet, 'id'>>} action - Bet details (type, numbers, amount)
     */
    addBet: (state, action: PayloadAction<Omit<Bet, 'id'>>) => {
      const newBet: Bet = {
        ...action.payload,
        id: uuidv4()  // Generate unique ID for the bet
      };
      state.bets.push(newBet);
      state.bankroll -= newBet.amount;  // Deduct bet amount from bankroll
    },
    
    /**
     * Removes a bet from the table
     * Returns the bet amount to the bankroll
     * 
     * @param {RouletteState} state - Current game state
     * @param {PayloadAction<string>} action - ID of bet to remove
     */
    removeBet: (state, action: PayloadAction<string>) => {
      const betToRemove = state.bets.find(bet => bet.id === action.payload);
      if (betToRemove) {
        state.bankroll += betToRemove.amount;  // Return bet amount to bankroll
        state.bets = state.bets.filter(bet => bet.id !== action.payload);
      }
    },
    
    /**
     * Clears all bets from the table
     * Returns all bet amounts to the bankroll
     * 
     * @param {RouletteState} state - Current game state
     */
    clearBets: (state) => {
      const totalBetAmount = state.bets.reduce((sum, bet) => sum + bet.amount, 0);
      state.bankroll += totalBetAmount;  // Return all bet amounts to bankroll
      state.bets = [];
    },
    
    /**
     * Spins the roulette wheel and processes all bet outcomes
     * Updates bankroll, bet history, and statistics
     * 
     * @param {RouletteState} state - Current game state
     * @param {PayloadAction<number>} action - The winning number from the spin
     */
    spinWheel: (state, action: PayloadAction<number>) => {
      const winningNumber = action.payload;
      state.history.push(winningNumber);
      
      // Process bets and calculate payouts for each
      state.bets.forEach(bet => {
        let payout = 0;
        
        // Check if bet is a winner (any of the bet numbers match the winning number)
        if (bet.numbers.includes(winningNumber)) {
          // Calculate payout based on bet type and standard roulette odds
          switch (bet.type) {
            case 'straight':
              payout = bet.amount * 36;  // 35:1 plus original bet
              break;
            case 'split':
              payout = bet.amount * 18;  // 17:1 plus original bet
              break;
            case 'street':
              payout = bet.amount * 12;  // 11:1 plus original bet
              break;
            case 'corner':
              payout = bet.amount * 9;   // 8:1 plus original bet
              break;
            case 'five':
              payout = bet.amount * 7;   // 6:1 plus original bet
              break;
            case 'line':
              payout = bet.amount * 6;   // 5:1 plus original bet
              break;
            case 'dozen':
            case 'column':
              payout = bet.amount * 3;   // 2:1 plus original bet
              break;
            case 'red':
            case 'black':
            case 'odd':
            case 'even':
            case 'low':
            case 'high':
              payout = bet.amount * 2;   // 1:1 plus original bet
              break;
            default:
              payout = 0;
          }
          
          state.bankroll += payout;  // Add winnings to bankroll
        }

        // Record the bet outcome in history for analysis and display
        const betResult: BetResult = {
          id: bet.id,
          type: bet.type,
          numbers: [...bet.numbers],
          amount: bet.amount,
          winningNumber,
          payout: payout - bet.amount, // Net win/loss (negative means loss)
          timestamp: Date.now()
        };
        
        state.betHistory.unshift(betResult); // Add to beginning of array (newest first)
        
        // Limit history size to 50 entries to prevent excessive memory usage
        if (state.betHistory.length > 50) {
          state.betHistory = state.betHistory.slice(0, 50);
        }
      });
      
      // Clear bets after spin (prepare for next round)
      state.bets = [];
      
      // Update statistical analysis based on new outcome
      updateStatistics(state);
    },
    
    /**
     * Changes the currently selected chip value
     * 
     * @param {RouletteState} state - Current game state
     * @param {PayloadAction<number>} action - New chip value
     */
    selectChip: (state, action: PayloadAction<number>) => {
      state.selectedChip = action.payload;
    },
    
    /**
     * Generates new betting recommendations based on game history
     * 
     * @param {RouletteState} state - Current game state
     */
    updateRecommendations: (state) => {
      // Calculate recommendations based on history and statistics
      state.recommendations = generateRecommendations(state);
    },
    
    /**
     * Resets the game to initial state (new game)
     * 
     * @param {RouletteState} state - Current game state
     */
    resetGame: (state) => {
      return initialState;
    },
    
    /**
     * Adds funds to the player's bankroll
     * 
     * @param {RouletteState} state - Current game state
     * @param {PayloadAction<number>} action - Amount to add
     */
    addFunds: (state, action: PayloadAction<number>) => {
      state.bankroll += action.payload;
    },
    
    /**
     * Clears the bet history
     * 
     * @param {RouletteState} state - Current game state
     */
    clearBetHistory: (state) => {
      state.betHistory = [];
    }
  }
});

/**
 * Updates game statistics based on spin history
 * 
 * Analyzes the game history to calculate:
 * - Hot numbers (most frequent)
 * - Cold numbers (least frequent)
 * - Ratio of red/black outcomes
 * - Ratio of odd/even outcomes
 * - Ratio of high/low outcomes
 * 
 * @param {RouletteState} state - Current game state
 */
const updateStatistics = (state: RouletteState) => {
  if (state.history.length === 0) return;
  
  // Count frequency of each number
  const numberCount: Record<number, number> = {};
  for (let i = 0; i <= 36; i++) {
    numberCount[i] = 0;
  }
  
  state.history.forEach(num => {
    numberCount[num]++;
  });
  
  // Identify hot and cold numbers based on frequency
  const entries = Object.entries(numberCount).map(([num, count]) => ({
    number: parseInt(num),
    count
  }));
  
  const sortedEntries = [...entries].sort((a, b) => b.count - a.count);
  state.statistics.hotNumbers = sortedEntries.slice(0, 5).map(e => e.number);  // Top 5 frequent numbers
  state.statistics.coldNumbers = sortedEntries.slice(-5).map(e => e.number);   // Bottom 5 frequent numbers
  
  // Calculate ratios for pattern analysis
  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  let redCount = 0, blackCount = 0;
  let oddCount = 0, evenCount = 0;
  let lowCount = 0, highCount = 0;
  
  state.history.forEach(num => {
    // Skip 0 (green - neither red nor black, neither odd nor even)
    if (num === 0) return;
    
    // Red/Black counting
    if (redNumbers.includes(num)) {
      redCount++;
    } else {
      blackCount++;
    }
    
    // Odd/Even counting
    if (num % 2 === 0) {
      evenCount++;
    } else {
      oddCount++;
    }
    
    // Low/High counting (1-18 vs 19-36)
    if (num <= 18) {
      lowCount++;
    } else {
      highCount++;
    }
  });
  
  // Calculate ratios (avoid division by zero)
  state.statistics.redBlackRatio = blackCount === 0 ? 0 : redCount / blackCount;
  state.statistics.oddEvenRatio = evenCount === 0 ? 0 : oddCount / evenCount;
  state.statistics.highLowRatio = lowCount === 0 ? 0 : highCount / lowCount;
};

/**
 * Generates betting recommendations based on game history and statistics
 * 
 * Analyzes patterns in the game history to suggest potentially favorable bets.
 * The recommendations consider:
 * - Frequency patterns (hot/cold numbers)
 * - Imbalances in red/black, odd/even, high/low outcomes
 * - Recent outcomes and potential "due" numbers
 * 
 * @param {RouletteState} state - Current game state
 * @returns {string[]} Array of recommendation messages
 */
const generateRecommendations = (state: RouletteState): string[] => {
  const recommendations: string[] = [];
  
  if (state.history.length < 10) {
    recommendations.push("Not enough data for reliable recommendations. Keep playing to improve advice.");
    return recommendations;
  }
  
  // Basic recommendations
  if (state.statistics.hotNumbers.length > 0) {
    recommendations.push(`Hot numbers: ${state.statistics.hotNumbers.join(', ')}. Consider betting on these.`);
  }
  
  if (state.statistics.coldNumbers.length > 0) {
    recommendations.push(`Cold numbers: ${state.statistics.coldNumbers.join(', ')}. These are due to hit.`);
  }
  
  // Check for streaks
  const lastFiveSpins = state.history.slice(-5);
  const allRed = lastFiveSpins.every(num => [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(num) && num !== 0);
  const allBlack = lastFiveSpins.every(num => ![0, 1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(num) && num !== 0);
  
  if (allRed) {
    recommendations.push("There's been a streak of RED numbers. Consider betting on BLACK for a change.");
  }
  
  if (allBlack) {
    recommendations.push("There's been a streak of BLACK numbers. Consider betting on RED for a change.");
  }
  
  // Check for balance
  if (state.bankroll < 100) {
    recommendations.push("Your bankroll is getting low. Consider placing smaller bets or adding more funds.");
  }
  
  return recommendations;
};

export const {
  addBet,
  removeBet,
  clearBets,
  spinWheel,
  selectChip,
  updateRecommendations,
  resetGame,
  addFunds,
  clearBetHistory
} = rouletteSlice.actions;

export default rouletteSlice.reducer; 
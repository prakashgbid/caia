/**
 * @file RouletteBoard.tsx
 * @description Interactive roulette board component that allows users to place bets
 * 
 * This component renders a virtual roulette board with:
 * - Interactive hotspots for different betting types (straight, dozen, column, etc.)
 * - Visual indicators for placed bets
 * - Dynamic scaling based on screen size
 * - Integration with the roulette game state
 * 
 * The board implements all standard European roulette betting options including:
 * - Straight bets (single numbers)
 * - Column bets (12 numbers in a vertical line)
 * - Dozen bets (groups of 12 consecutive numbers)
 * - Even money bets (red/black, odd/even, high/low)
 */

import React, { useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, Paper, styled, Grid } from '@mui/material';
import { RootState } from '../../app/store';
import { addBet, BetType } from './rouletteSlice';
import BetHistory from './BetHistory';
import BetDetails from './BetDetails';

/**
 * Styled Components
 * 
 * These styled components create the visual elements of the roulette board
 * and betting interface with proper spacing, positioning and hover effects.
 */

/**
 * Main container for the roulette board
 * Provides responsive sizing and proper spacing
 */
const BoardContainer = styled(Box)(({ theme }) => ({
  position: 'relative',
  maxWidth: '1200px', // Increased to accommodate history panel
  margin: '0 auto',
  marginTop: theme.spacing(2),
  marginBottom: theme.spacing(4),
}));

/**
 * Styled component for the roulette board image
 * Ensures the image is responsive and properly sized
 */
const BoardImage = styled('img')(({ theme }) => ({
  width: '100%',
  height: 'auto',
  display: 'block',
}));

/**
 * Container for all interactive betting elements
 * Positioned absolutely over the board image
 */
const BettingOverlay = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: 0,
  left: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none', // Allow clicks to pass through to the hotspots
}));

/**
 * Interactive betting hotspot
 * Changes appearance based on user selection and hover state
 * 
 * @prop {boolean} isSelected - Whether this betting position has a bet placed on it
 */
const BettingHotspot = styled(Box, {
  shouldForwardProp: (prop) => prop !== 'isSelected'
})<{ isSelected?: boolean }>(({ theme, isSelected }) => ({
  position: 'absolute',
  cursor: 'pointer',
  borderRadius: '4px',
  border: isSelected ? `2px solid ${theme.palette.primary.main}` : 'none',
  backgroundColor: isSelected ? 'rgba(25, 118, 210, 0.3)' : 'rgba(255, 255, 255, 0.05)',
  pointerEvents: 'auto',
  transform: 'translate(-50%, -50%)',
  '&:hover': {
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
  },
}));

/**
 * Visual indicator for a placed bet
 * Shows the chip amount placed on a betting position
 */
const ChipIndicator = styled(Box)(({ theme }) => ({
  position: 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  borderRadius: '50%',
  backgroundColor: theme.palette.primary.main,
  color: 'white',
  fontWeight: 'bold',
  fontSize: '0.75rem',
  width: '28px',
  height: '28px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: theme.shadows[3],
  zIndex: 10,
}));

/**
 * Interface defining a betting position on the roulette board
 * 
 * @property {BetType} type - The type of bet (straight, dozen, column, etc.)
 * @property {number[]} numbers - Array of numbers this position covers
 * @property {string} left - CSS position from left edge (percentage)
 * @property {string} top - CSS position from top edge (percentage)
 * @property {string} width - CSS width (percentage)
 * @property {string} height - CSS height (percentage)
 */
interface BettingPosition {
  type: BetType;
  numbers: number[];
  left: string;
  top: string;
  width: string;
  height: string;
}

/**
 * RouletteBoard Component
 * 
 * Renders an interactive roulette table with betting positions
 * that users can click to place chips. Integrates with the Redux
 * store to track bets and selected chip values.
 * 
 * @returns {JSX.Element} The rendered roulette board
 */
const RouletteBoard: React.FC = () => {
  const dispatch = useDispatch();
  // Get the currently selected chip value and placed bets from Redux
  const selectedChip = useSelector((state: RootState) => state.roulette.selectedChip);
  const bets = useSelector((state: RootState) => state.roulette.bets);
  // Reference to the board image for dimension calculations
  const boardRef = useRef<HTMLImageElement>(null);

  /**
   * Effect to update board dimensions on window resize
   * Ensures the betting positions scale correctly with the board image
   */
  useEffect(() => {
    const updateDimensions = () => {
      if (boardRef.current) {
        // We're not using boardDimensions state in this component currently,
        // but keeping the ref for future enhancements
      }
    };

    updateDimensions();
    window.addEventListener('resize', updateDimensions);
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  /**
   * Generates all available betting positions on the roulette board
   * 
   * This function creates the data for all possible bet placements, including:
   * - Straight bets (0-36)
   * - Dozen bets (1st, 2nd, 3rd dozen)
   * - Column bets (columns 1, 2, 3)
   * - Even money bets (red/black, odd/even, high/low)
   * 
   * Each position includes the bet type, numbers covered, and position coordinates
   * 
   * @returns {BettingPosition[]} Array of all betting positions
   */
  const generateBettingPositions = (): BettingPosition[] => {
    const positions: BettingPosition[] = [];
    
    // Straight bet for zero (green 0)
    positions.push({
      type: 'straight',
      numbers: [0],
      left: '9.5%',
      top: '29%',
      width: '5%',
      height: '5%'
    });
    
    // Straight bets for numbers 1-36 (3 rows x 12 columns)
    // Creates a grid of individual number betting positions
    const numberPositions = Array.from({ length: 36 }, (_, i) => {
      const num = i + 1;
      const row = Math.floor((37 - num - 1) / 12); // Reverse row order (bottom to top)
      const col = (num - 1) % 12;
      
      return {
        type: 'straight' as BetType,
        numbers: [num],
        left: `${18.25 + col * 6.5}%`,
        top: `${28 + row * 18}%`,
        width: '5%',
        height: '5%'
      };
    });
    
    positions.push(...numberPositions);
    
    // Dozen bets (1-12, 13-24, 25-36)
    positions.push(
      {
        type: 'dozen',
        numbers: Array.from({ length: 12 }, (_, i) => i + 1),
        left: '29.5%',
        top: '80.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'dozen',
        numbers: Array.from({ length: 12 }, (_, i) => i + 13),
        left: '51.5%',
        top: '80.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'dozen',
        numbers: Array.from({ length: 12 }, (_, i) => i + 25),
        left: '73.5%',
        top: '80.5%',
        width: '5%',
        height: '5%'
      }
    );
    
    // Column bets (vertical lines of 12 numbers)
    positions.push(
      {
        type: 'column',
        numbers: [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34],
        left: '96%',
        top: '28%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'column',
        numbers: [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35],
        left: '96%',
        top: '46%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'column',
        numbers: [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36],
        left: '96%',
        top: '64%',
        width: '5%',
        height: '5%'
      }
    );
    
    // Even money bets (pays 1:1)
    positions.push(
      {
        type: 'red',
        numbers: [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36],
        left: '25%',
        top: '91.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'black',
        numbers: [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35],
        left: '36%',
        top: '91.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'odd',
        numbers: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33, 35],
        left: '47%',
        top: '91.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'even',
        numbers: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36],
        left: '58%',
        top: '91.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'low',
        numbers: Array.from({ length: 18 }, (_, i) => i + 1),
        left: '69%',
        top: '91.5%',
        width: '5%',
        height: '5%'
      },
      {
        type: 'high',
        numbers: Array.from({ length: 18 }, (_, i) => i + 19),
        left: '80%',
        top: '91.5%',
        width: '5%',
        height: '5%'
      }
    );
    
    return positions;
  };

  // Generate all betting positions for the board
  const bettingPositions = generateBettingPositions();

  /**
   * Checks if a bet is placed on a specific betting position
   * 
   * @param {number[]} numbers - The numbers covered by this betting position
   * @returns {boolean} True if a bet is placed on any of these numbers
   */
  const isBetPlaced = (numbers: number[]): boolean => {
    return bets.some(bet => 
      bet.numbers.some(num => numbers.includes(num))
    );
  };

  // Handle bet placement
  const handlePlaceBet = (type: BetType, numbers: number[]) => {
    dispatch(addBet({
      type,
      numbers,
      amount: selectedChip
    }));
  };

  return (
    <BoardContainer>
      <Typography variant="h4" gutterBottom align="center">
        Roulette Table
      </Typography>
      
      <Grid container spacing={2}>
        {/* Bet History Panel - Left Side */}
        <Grid item xs={12} md={3}>
          <BetHistory />
        </Grid>
        
        {/* Roulette Board - Center */}
        <Grid item xs={12} md={6}>
          <Paper elevation={3} sx={{ overflow: 'hidden', borderRadius: 2 }}>
            <Box position="relative">
              <BoardImage 
                ref={boardRef}
                src="/roulette_board_img.png" 
                alt="Roulette Board" 
              />
              
              <BettingOverlay>
                {bettingPositions.map((position, index) => {
                  const betPlaced = isBetPlaced(position.numbers);
                  return (
                    <BettingHotspot
                      key={index}
                      isSelected={betPlaced}
                      onClick={() => handlePlaceBet(position.type, position.numbers)}
                      sx={{
                        left: position.left,
                        top: position.top,
                        width: position.width,
                        height: position.height,
                      }}
                    >
                      {betPlaced && (
                        <ChipIndicator>
                          ${selectedChip}
                        </ChipIndicator>
                      )}
                    </BettingHotspot>
                  );
                })}
              </BettingOverlay>
            </Box>
          </Paper>
        </Grid>

        {/* Bet Details Panel - Right Side */}
        <Grid item xs={12} md={3}>
          <BetDetails />
        </Grid>
      </Grid>
    </BoardContainer>
  );
};

export default RouletteBoard; 
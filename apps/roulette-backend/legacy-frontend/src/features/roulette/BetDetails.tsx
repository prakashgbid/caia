import React from 'react';
import { useSelector } from 'react-redux';
import { 
  Box, 
  Paper, 
  Typography, 
  List, 
  ListItem, 
  Divider, 
  Chip, 
  styled 
} from '@mui/material';
import { RootState } from '../../app/store';
import { BetType, Bet } from './rouletteSlice';

const DetailsContainer = styled(Paper)(({ theme }) => ({
  width: '100%',
  height: '100%',
  padding: theme.spacing(2),
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
  boxShadow: theme.shadows[3],
}));

const BetChip = styled(Chip)(({ theme }) => ({
  fontWeight: 'bold',
  marginLeft: theme.spacing(1),
}));

const NoBetrTypography = styled(Typography)(({ theme }) => ({
  textAlign: 'center',
  color: theme.palette.text.secondary,
  marginTop: theme.spacing(4),
  marginBottom: theme.spacing(4),
}));

// Helper function to get color for a number (red/black/green)
const getNumberColor = (num: number): string => {
  if (num === 0) return '#4CAF50'; // Green
  
  const redNumbers = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  return redNumbers.includes(num) ? '#e53935' : '#1e1e1e';
};

// Helper function to format bet type
const formatBetType = (type: BetType, numbers: number[]): string => {
  switch (type) {
    case 'straight':
      return `Straight bet on ${numbers[0]}`;
    case 'split':
      return `Split bet on ${numbers.join(', ')}`;
    case 'street':
      return `Street bet on ${numbers.join(', ')}`;
    case 'corner':
      return `Corner bet on ${numbers.join(', ')}`;
    case 'five':
      return 'Five number bet';
    case 'line':
      return `Line bet on ${numbers.join(', ')}`;
    case 'dozen':
      if (numbers.includes(1)) return '1st Dozen (1-12)';
      if (numbers.includes(13)) return '2nd Dozen (13-24)';
      return '3rd Dozen (25-36)';
    case 'column':
      if (numbers.includes(1)) return '1st Column';
      if (numbers.includes(2)) return '2nd Column';
      return '3rd Column';
    case 'red':
      return 'Red';
    case 'black':
      return 'Black';
    case 'odd':
      return 'Odd';
    case 'even':
      return 'Even';
    case 'low':
      return 'Low (1-18)';
    case 'high':
      return 'High (19-36)';
    default:
      return type;
  }
};

// Helper function to get bet priority for sorting
const getBetPriority = (bet: Bet): number => {
  // Order: straight bets by number (0 first), then other bet types
  if (bet.type === 'straight') {
    return bet.numbers[0]; // Numbers will be ordered 0, 1, 2, ...
  } else {
    // For other bet types, prioritize them after straight bets
    // The order will be: dozen, column, outside bets
    switch(bet.type) {
      case 'dozen': return 100;
      case 'column': return 200;
      case 'red': return 300;
      case 'black': return 301;
      case 'odd': return 302;
      case 'even': return 303;
      case 'low': return 304;
      case 'high': return 305;
      case 'split': return 400;
      case 'street': return 500;
      case 'corner': return 600;
      case 'line': return 700;
      case 'five': return 800;
      default: return 900;
    }
  }
};

const BetDetails: React.FC = () => {
  const bets = useSelector((state: RootState) => state.roulette.bets);
  const totalBetAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);

  // Sort bets by type and number for display
  const sortedBets = [...bets].sort((a, b) => getBetPriority(a) - getBetPriority(b));

  return (
    <DetailsContainer>
      <Typography variant="h6" gutterBottom align="center">
        Current Bets
      </Typography>
      
      <Typography 
        variant="subtitle1" 
        gutterBottom 
        align="center" 
        sx={{
          fontWeight: 'bold',
          color: totalBetAmount > 0 ? 'primary.main' : 'text.secondary'
        }}
      >
        Total: ${totalBetAmount.toFixed(2)}
      </Typography>
      
      {bets.length === 0 ? (
        <NoBetrTypography variant="body1">
          No active bets. Place your bets!
        </NoBetrTypography>
      ) : (
        <List sx={{ maxHeight: '400px', overflow: 'auto' }}>
          {sortedBets.map((bet, index) => (
            <React.Fragment key={`${bet.id}-${index}`}>
              <ListItem sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', py: 1 }}>
                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="subtitle2">
                    {formatBetType(bet.type, bet.numbers)}
                  </Typography>
                  <BetChip 
                    label={`$${bet.amount}`} 
                    color="primary" 
                    size="small" 
                  />
                </Box>
                
                {bet.type === 'straight' && (
                  <Box sx={{ display: 'flex', alignItems: 'center', mt: 1 }}>
                    <Chip 
                      label={bet.numbers[0]} 
                      size="small"
                      sx={{ 
                        bgcolor: getNumberColor(bet.numbers[0]),
                        color: 'white',
                        fontWeight: 'bold'
                      }}
                    />
                  </Box>
                )}
              </ListItem>
              {index < sortedBets.length - 1 && <Divider />}
            </React.Fragment>
          ))}
        </List>
      )}
      
      <Box sx={{ mt: 2 }}>
        <Typography variant="caption" color="text.secondary">
          * Bets will be cleared after spin
        </Typography>
      </Box>
    </DetailsContainer>
  );
};

export default BetDetails; 
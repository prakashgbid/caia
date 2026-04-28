import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { 
  Box, 
  Paper, 
  Typography, 
  List, 
  ListItem, 
  Divider, 
  Chip, 
  styled,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { RootState } from '../../app/store';
import { BetResult, BetType } from './rouletteSlice';

const HistoryContainer = styled(Paper)(({ theme }) => ({
  width: '100%',
  maxHeight: '600px',
  overflowY: 'auto',
  padding: theme.spacing(2),
  marginBottom: theme.spacing(2),
  borderRadius: theme.shape.borderRadius,
  backgroundColor: theme.palette.background.paper,
  boxShadow: theme.shadows[3],
}));

const BetItemContainer = styled(Box)(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
}));

const BetItemHeader = styled(Box)(({ theme }) => ({
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  width: '100%',
}));

const BetChip = styled(Chip)(({ theme }) => ({
  fontWeight: 'bold',
  marginLeft: theme.spacing(1),
}));

const ResultChip = styled(Chip, {
  shouldForwardProp: (prop) => prop !== 'isWin'
})<{ isWin: boolean }>(({ theme, isWin }) => ({
  backgroundColor: isWin ? theme.palette.success.main : theme.palette.error.main,
  color: theme.palette.common.white,
  fontWeight: 'bold',
}));

const WinningNumberChip = styled(Chip)(({ theme }) => ({
  fontWeight: 'bold',
  fontSize: '1rem',
  marginRight: theme.spacing(1),
}));

const CustomAccordion = styled(Accordion)(({ theme }) => ({
  marginBottom: theme.spacing(1),
  '&::before': {
    display: 'none',
  },
  boxShadow: 'none',
  border: `1px solid ${theme.palette.divider}`,
}));

const CustomAccordionSummary = styled(AccordionSummary)(({ theme }) => ({
  padding: theme.spacing(0, 2),
  '& .MuiAccordionSummary-content': {
    margin: theme.spacing(1, 0),
  },
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

// Helper function to format timestamp
const formatTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

// Group bets by spin (same timestamp and winning number)
interface GroupedBet {
  winningNumber: number;
  timestamp: number;
  bets: BetResult[];
  totalAmount: number;
  totalPayout: number;
}

const BetHistory: React.FC = () => {
  const betHistory = useSelector((state: RootState) => state.roulette.betHistory);

  // Group bets by play
  const groupedBets = useMemo(() => {
    const groups: GroupedBet[] = [];
    
    betHistory.forEach(bet => {
      // Check if there's already a group with the same winning number and similar timestamp
      // (within 1 second of each other)
      const existingGroup = groups.find(group => 
        group.winningNumber === bet.winningNumber && 
        Math.abs(group.timestamp - bet.timestamp) < 1000
      );
      
      if (existingGroup) {
        existingGroup.bets.push(bet);
        existingGroup.totalAmount += bet.amount;
        existingGroup.totalPayout += bet.payout;
      } else {
        groups.push({
          winningNumber: bet.winningNumber,
          timestamp: bet.timestamp,
          bets: [bet],
          totalAmount: bet.amount,
          totalPayout: bet.payout
        });
      }
    });
    
    return groups;
  }, [betHistory]);

  return (
    <HistoryContainer>
      <Typography variant="h6" gutterBottom align="center">
        Bet History
      </Typography>
      
      {groupedBets.length === 0 ? (
        <Typography variant="body1" align="center" color="textSecondary" sx={{ my: 3 }}>
          No betting history yet. Place bets and spin to see results.
        </Typography>
      ) : (
        <List>
          {groupedBets.map((group, groupIndex) => (
            <CustomAccordion key={`group-${groupIndex}`}>
              <CustomAccordionSummary
                expandIcon={<ExpandMoreIcon />}
                aria-controls={`panel${groupIndex}-content`}
                id={`panel${groupIndex}-header`}
              >
                <Box sx={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <WinningNumberChip 
                      label={group.winningNumber} 
                      sx={{ 
                        bgcolor: getNumberColor(group.winningNumber),
                        color: 'white',
                      }}
                    />
                    <Typography variant="subtitle2">
                      {formatTimestamp(group.timestamp)}
                    </Typography>
                  </Box>
                  
                  <Box sx={{ display: 'flex', alignItems: 'center' }}>
                    <Typography variant="body2" sx={{ mr: 1 }}>
                      Bet: ${group.totalAmount.toFixed(2)}
                    </Typography>
                    <ResultChip
                      isWin={group.totalPayout > 0}
                      icon={group.totalPayout > 0 ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
                      label={`${group.totalPayout > 0 ? '+' : ''}$${group.totalPayout.toFixed(2)}`}
                    />
                  </Box>
                </Box>
              </CustomAccordionSummary>
              
              <AccordionDetails sx={{ pt: 0 }}>
                <Divider sx={{ mb: 2 }} />
                <List disablePadding>
                  {group.bets.map((bet, betIndex) => (
                    <ListItem 
                      key={`bet-${bet.id}-${betIndex}`} 
                      sx={{ 
                        display: 'flex', 
                        flexDirection: 'column', 
                        alignItems: 'flex-start',
                        py: 1,
                        px: 0
                      }}
                    >
                      <BetItemContainer>
                        <BetItemHeader>
                          <Typography variant="subtitle2">
                            {formatBetType(bet.type, bet.numbers)}
                          </Typography>
                          <BetChip 
                            label={`$${bet.amount}`} 
                            size="small" 
                          />
                        </BetItemHeader>
                        
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1, width: '100%' }}>
                          {bet.type === 'straight' && (
                            <Box sx={{ display: 'flex', alignItems: 'center' }}>
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
                          
                          <ResultChip
                            isWin={bet.payout > 0}
                            icon={bet.payout > 0 ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
                            label={`${bet.payout > 0 ? '+' : ''}$${bet.payout}`}
                            size="small"
                            sx={{ ml: 'auto' }}
                          />
                        </Box>
                      </BetItemContainer>
                      {betIndex < group.bets.length - 1 && <Divider sx={{ width: '100%', my: 1 }} />}
                    </ListItem>
                  ))}
                </List>
              </AccordionDetails>
            </CustomAccordion>
          ))}
        </List>
      )}
    </HistoryContainer>
  );
};

export default BetHistory; 
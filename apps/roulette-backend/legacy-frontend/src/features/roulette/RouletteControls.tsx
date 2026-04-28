import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { 
  Box, 
  Button, 
  Typography, 
  Paper, 
  Stack,
  TextField,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  CircularProgress,
  Alert,
  Grid
} from '@mui/material';
import CasinoIcon from '@mui/icons-material/Casino';
import AttachMoneyIcon from '@mui/icons-material/AttachMoney';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import RecommendIcon from '@mui/icons-material/Recommend';
import RestartAltIcon from '@mui/icons-material/RestartAlt';

import { RootState } from '../../app/store';
import { 
  spinWheel, 
  clearBets, 
  selectChip, 
  resetGame,
  updateRecommendations,
  addFunds
} from './rouletteSlice';

const RouletteControls: React.FC = () => {
  const dispatch = useDispatch();
  const { 
    bankroll, 
    bets, 
    selectedChip, 
    history, 
    recommendations 
  } = useSelector((state: RootState) => state.roulette);
  
  const [isSpinning, setIsSpinning] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showRecommendations, setShowRecommendations] = useState(false);
  const [fundAmount, setFundAmount] = useState(100);
  const [showAddFundsDialog, setShowAddFundsDialog] = useState(false);
  
  const chipValues = [1, 5, 10, 25, 50, 100, 500, 1000];
  
  const totalBetAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);
  
  const handleSpin = () => {
    if (bets.length === 0) return;
    
    setIsSpinning(true);
    
    // Simulate delay for spinning animation
    setTimeout(() => {
      // Generate random number 0-36
      const winningNumber = Math.floor(Math.random() * 37);
      dispatch(spinWheel(winningNumber));
      dispatch(updateRecommendations());
      setIsSpinning(false);
    }, 2000);
  };
  
  const handleChipSelect = (value: number) => {
    dispatch(selectChip(value));
  };
  
  const handleClearBets = () => {
    dispatch(clearBets());
  };
  
  const handleReset = () => {
    dispatch(resetGame());
  };
  
  const handleAddFunds = () => {
    if (fundAmount > 0) {
      dispatch(addFunds(fundAmount));
      setShowAddFundsDialog(false);
    }
  };
  
  return (
    <Box sx={{ maxWidth: 1000, margin: '0 auto', mt: 2, mb: 4 }}>
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Grid container spacing={2}>
          <Grid item xs={6}>
            <Typography variant="h6" gutterBottom>
              Bankroll: ${bankroll.toFixed(2)}
            </Typography>
            <Typography variant="body1" gutterBottom>
              Current Bets: ${totalBetAmount.toFixed(2)}
            </Typography>
          </Grid>
          
          <Grid item xs={6} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Stack direction="row" spacing={1}>
              <Button 
                variant="contained" 
                color="primary"
                startIcon={<AttachMoneyIcon />}
                onClick={() => setShowAddFundsDialog(true)}
                size="small"
              >
                Add Funds
              </Button>
              
              <Button 
                variant="outlined"
                startIcon={<HistoryIcon />}
                onClick={() => setShowHistory(true)}
                size="small"
              >
                History
              </Button>
              
              <Button 
                variant="outlined"
                startIcon={<RecommendIcon />}
                onClick={() => setShowRecommendations(true)}
                size="small"
              >
                Tips
              </Button>
            </Stack>
          </Grid>
        </Grid>
      </Paper>
      
      <Paper elevation={3} sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" gutterBottom>
          Select Chip
        </Typography>
        
        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
          {chipValues.map(value => (
            <Chip
              key={value}
              label={`$${value}`}
              color={selectedChip === value ? 'primary' : 'default'}
              onClick={() => handleChipSelect(value)}
              sx={{ 
                fontSize: '1rem', 
                height: 40, 
                width: 65,
                mb: 1,
                fontWeight: selectedChip === value ? 'bold' : 'normal'
              }}
            />
          ))}
        </Stack>
        
        <Stack direction="row" spacing={2} sx={{ mt: 3 }}>
          <Button 
            variant="contained"
            color="success"
            startIcon={<CasinoIcon />}
            onClick={handleSpin}
            disabled={bets.length === 0 || isSpinning}
            fullWidth
            size="large"
          >
            {isSpinning ? <CircularProgress size={24} color="inherit" /> : 'Spin'}
          </Button>
          
          <Button 
            variant="outlined"
            color="error"
            startIcon={<DeleteIcon />}
            onClick={handleClearBets}
            disabled={bets.length === 0 || isSpinning}
          >
            Clear Bets
          </Button>
          
          <Button 
            variant="outlined"
            color="warning"
            startIcon={<RestartAltIcon />}
            onClick={handleReset}
          >
            Reset Game
          </Button>
        </Stack>
      </Paper>
      
      {/* History Dialog */}
      <Dialog open={showHistory} onClose={() => setShowHistory(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Game History</DialogTitle>
        <DialogContent dividers>
          {history.length === 0 ? (
            <Alert severity="info">No game history yet. Start playing to track results.</Alert>
          ) : (
            <>
              <Typography variant="subtitle1" gutterBottom>
                Last 10 Numbers:
              </Typography>
              
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {history.slice(-10).reverse().map((num, idx) => {
                  const isRed = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36].includes(num);
                  const bgColor = num === 0 ? '#4CAF50' : isRed ? '#e53935' : '#1e1e1e';
                  
                  return (
                    <Chip
                      key={idx}
                      label={num}
                      sx={{
                        bgcolor: bgColor,
                        color: 'white',
                        fontWeight: 'bold',
                        fontSize: '1rem',
                        mb: 1
                      }}
                    />
                  );
                })}
              </Stack>
              
              <Typography variant="subtitle1" sx={{ mt: 2 }}>
                Win/Loss History:
              </Typography>
              
              <Typography variant="body1">
                Total Spins: {history.length}
              </Typography>
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowHistory(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      
      {/* Recommendations Dialog */}
      <Dialog open={showRecommendations} onClose={() => setShowRecommendations(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Betting Recommendations</DialogTitle>
        <DialogContent dividers>
          {recommendations.length === 0 ? (
            <Alert severity="info">
              Play a few rounds to receive personalized betting recommendations.
            </Alert>
          ) : (
            <Stack spacing={2}>
              {recommendations.map((recommendation, idx) => (
                <Alert key={idx} severity="info" icon={<RecommendIcon />}>
                  {recommendation}
                </Alert>
              ))}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowRecommendations(false)}>Close</Button>
        </DialogActions>
      </Dialog>
      
      {/* Add Funds Dialog */}
      <Dialog open={showAddFundsDialog} onClose={() => setShowAddFundsDialog(false)}>
        <DialogTitle>Add Funds</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Amount"
            type="number"
            fullWidth
            variant="outlined"
            value={fundAmount}
            onChange={(e) => setFundAmount(Number(e.target.value))}
            InputProps={{
              startAdornment: <AttachMoneyIcon />,
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAddFundsDialog(false)}>Cancel</Button>
          <Button onClick={handleAddFunds} color="primary">
            Add Funds
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default RouletteControls; 
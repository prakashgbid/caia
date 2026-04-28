const Bet = require('../../models/Bet');
const User = require('../../models/User');
const Game = require('../../models/Game');
const { v4: uuidv4 } = require('uuid');

/**
 * Create new bets
 * @route POST /api/bets
 */
exports.createBets = async (req, res) => {
  try {
    const { bets, gameId, winningNumber } = req.body;
    
    if (!bets || !Array.isArray(bets) || bets.length === 0) {
      return res.status(400).json({
        status: 'fail',
        message: 'No bets provided'
      });
    }
    
    // Get user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found'
      });
    }
    
    // Get or create a game
    let game;
    if (gameId) {
      game = await Game.findOne({ 
        _id: gameId, 
        user: req.user.id,
        status: 'active'
      });
      
      if (!game) {
        return res.status(404).json({
          status: 'fail',
          message: 'Active game not found'
        });
      }
    } else {
      // Create a new game
      game = await Game.create({
        user: req.user.id,
        bankrollStart: user.bankroll
      });
    }
    
    // Generate play ID for this round
    const playId = uuidv4();
    
    // Calculate total bet amount
    const totalBetAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);
    
    // Check if user has enough funds
    if (user.bankroll < totalBetAmount) {
      return res.status(400).json({
        status: 'fail',
        message: 'Insufficient funds'
      });
    }
    
    // Deduct the total bet amount from the user's bankroll
    user.bankroll -= totalBetAmount;
    await user.save();
    
    // Process bets
    const betResults = [];
    let totalPayout = 0;
    
    for (const bet of bets) {
      let payout = 0;
      
      // Calculate payout based on bet type and winning number
      if (bet.numbers.includes(winningNumber)) {
        switch (bet.type) {
          case 'straight':
            payout = bet.amount * 36;
            break;
          case 'split':
            payout = bet.amount * 18;
            break;
          case 'street':
            payout = bet.amount * 12;
            break;
          case 'corner':
            payout = bet.amount * 9;
            break;
          case 'five':
            payout = bet.amount * 7;
            break;
          case 'line':
            payout = bet.amount * 6;
            break;
          case 'dozen':
          case 'column':
            payout = bet.amount * 3;
            break;
          case 'red':
          case 'black':
          case 'odd':
          case 'even':
          case 'low':
          case 'high':
            payout = bet.amount * 2;
            break;
          default:
            payout = 0;
        }
      }
      
      totalPayout += payout;
      
      // Create bet record
      const betResult = await Bet.create({
        user: req.user.id,
        type: bet.type,
        numbers: bet.numbers,
        amount: bet.amount,
        winningNumber,
        payout: payout - bet.amount, // Net win/loss
        playId
      });
      
      betResults.push(betResult);
    }
    
    // Add winning number to game history
    game.history.push(winningNumber);
    
    // Update game statistics
    game.updateStatistics();
    await game.save();
    
    // Add payout to user's bankroll
    user.bankroll += totalPayout;
    await user.save();
    
    res.status(201).json({
      status: 'success',
      data: {
        bets: betResults,
        gameId: game._id,
        totalBetAmount,
        totalPayout,
        netResult: totalPayout - totalBetAmount,
        currentBankroll: user.bankroll
      }
    });
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
};

/**
 * Get bet history for current user
 * @route GET /api/bets
 */
exports.getBetHistory = async (req, res) => {
  try {
    const { page = 1, limit = 20, gameId } = req.query;
    
    const query = { user: req.user.id };
    
    // Filter by game if provided
    if (gameId) {
      const game = await Game.findOne({ _id: gameId, user: req.user.id });
      if (!game) {
        return res.status(404).json({
          status: 'fail',
          message: 'Game not found'
        });
      }
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    // Get bets and group them by playId
    const bets = await Bet.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    // Group bets by play ID
    const playGroups = {};
    bets.forEach(bet => {
      if (!playGroups[bet.playId]) {
        playGroups[bet.playId] = {
          playId: bet.playId,
          winningNumber: bet.winningNumber,
          timestamp: bet.createdAt,
          bets: [],
          totalAmount: 0,
          totalPayout: 0
        };
      }
      
      playGroups[bet.playId].bets.push(bet);
      playGroups[bet.playId].totalAmount += bet.amount;
      playGroups[bet.playId].totalPayout += bet.payout;
    });
    
    const totalBets = await Bet.countDocuments(query);
    
    res.status(200).json({
      status: 'success',
      results: Object.keys(playGroups).length,
      totalBets,
      data: {
        plays: Object.values(playGroups)
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalBets / limit)
      }
    });
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
};

/**
 * Get bet statistics
 * @route GET /api/bets/stats
 */
exports.getBetStats = async (req, res) => {
  try {
    const { gameId } = req.query;
    
    let query = { user: req.user.id };
    
    // If game ID is provided, get stats only for that game
    if (gameId) {
      const game = await Game.findOne({ _id: gameId, user: req.user.id });
      if (!game) {
        return res.status(404).json({
          status: 'fail',
          message: 'Game not found'
        });
      }
      
      // Return the game statistics directly
      return res.status(200).json({
        status: 'success',
        data: {
          stats: game.statistics,
          history: game.history,
          totalBets: await Bet.countDocuments({ user: req.user.id }),
          profitLoss: game.profitLoss
        }
      });
    }
    
    // Get all bets for the user
    const bets = await Bet.find(query);
    
    // Calculate statistics
    const totalBetAmount = bets.reduce((sum, bet) => sum + bet.amount, 0);
    const totalPayout = bets.reduce((sum, bet) => sum + bet.payout, 0);
    
    // Group by bet type
    const betTypeStats = {};
    bets.forEach(bet => {
      if (!betTypeStats[bet.type]) {
        betTypeStats[bet.type] = {
          count: 0,
          amount: 0,
          payout: 0,
          winCount: 0,
          lossCount: 0
        };
      }
      
      betTypeStats[bet.type].count += 1;
      betTypeStats[bet.type].amount += bet.amount;
      betTypeStats[bet.type].payout += bet.payout;
      
      if (bet.payout > 0) {
        betTypeStats[bet.type].winCount += 1;
      } else {
        betTypeStats[bet.type].lossCount += 1;
      }
    });
    
    res.status(200).json({
      status: 'success',
      data: {
        totalBets: bets.length,
        totalBetAmount,
        totalPayout,
        profitLoss: totalPayout,
        betTypeStats
      }
    });
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
}; 
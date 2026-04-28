const Game = require('../../models/Game');
const User = require('../../models/User');
const Bet = require('../../models/Bet');

/**
 * Start a new game
 * @route POST /api/game/start
 */
exports.startGame = async (req, res) => {
  try {
    // Get user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        status: 'fail',
        message: 'User not found'
      });
    }
    
    // Check for existing active game
    const existingActiveGame = await Game.findOne({
      user: req.user.id,
      status: 'active'
    });
    
    if (existingActiveGame) {
      return res.status(400).json({
        status: 'fail',
        message: 'You already have an active game. Complete or abandon it before starting a new one.',
        gameId: existingActiveGame._id
      });
    }
    
    // Create new game
    const game = await Game.create({
      user: req.user.id,
      bankrollStart: user.bankroll
    });
    
    res.status(201).json({
      status: 'success',
      data: {
        game
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
 * End current game
 * @route PATCH /api/game/:id/end
 */
exports.endGame = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get game
    const game = await Game.findOne({
      _id: id,
      user: req.user.id,
      status: 'active'
    });
    
    if (!game) {
      return res.status(404).json({
        status: 'fail',
        message: 'Active game not found'
      });
    }
    
    // Get user's current bankroll
    const user = await User.findById(req.user.id);
    
    // Update game
    game.status = 'completed';
    game.endTime = Date.now();
    game.bankrollEnd = user.bankroll;
    await game.save();
    
    res.status(200).json({
      status: 'success',
      data: {
        game,
        profitLoss: game.profitLoss,
        duration: game.duration
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
 * Abandon current game
 * @route PATCH /api/game/:id/abandon
 */
exports.abandonGame = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get game
    const game = await Game.findOne({
      _id: id,
      user: req.user.id,
      status: 'active'
    });
    
    if (!game) {
      return res.status(404).json({
        status: 'fail',
        message: 'Active game not found'
      });
    }
    
    // Get user's current bankroll
    const user = await User.findById(req.user.id);
    
    // Update game
    game.status = 'abandoned';
    game.endTime = Date.now();
    game.bankrollEnd = user.bankroll;
    await game.save();
    
    res.status(200).json({
      status: 'success',
      data: {
        game,
        profitLoss: game.profitLoss,
        duration: game.duration
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
 * Get game history
 * @route GET /api/game
 */
exports.getGameHistory = async (req, res) => {
  try {
    const { page = 1, limit = 10, status } = req.query;
    
    const query = { user: req.user.id };
    
    // Filter by status if provided
    if (status) {
      query.status = status;
    }
    
    // Pagination
    const skip = (page - 1) * limit;
    
    // Get games
    const games = await Game.find(query)
      .sort({ startTime: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalGames = await Game.countDocuments(query);
    
    // Get additional stats for each game
    const gamesWithStats = await Promise.all(
      games.map(async (game) => {
        const betCount = await Bet.countDocuments({
          user: req.user.id,
          createdAt: { 
            $gte: game.startTime, 
            $lte: game.endTime || Date.now() 
          }
        });
        
        return {
          ...game.toObject(),
          betCount,
          duration: game.duration,
          profitLoss: game.profitLoss
        };
      })
    );
    
    res.status(200).json({
      status: 'success',
      results: games.length,
      totalGames,
      data: {
        games: gamesWithStats
      },
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(totalGames / limit)
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
 * Get game details
 * @route GET /api/game/:id
 */
exports.getGameDetails = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get game
    const game = await Game.findOne({
      _id: id,
      user: req.user.id
    });
    
    if (!game) {
      return res.status(404).json({
        status: 'fail',
        message: 'Game not found'
      });
    }
    
    // Get bets for this game
    const bets = await Bet.find({
      user: req.user.id,
      createdAt: { 
        $gte: game.startTime, 
        $lte: game.endTime || Date.now() 
      }
    }).sort({ createdAt: -1 });
    
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
    
    res.status(200).json({
      status: 'success',
      data: {
        game: {
          ...game.toObject(),
          duration: game.duration,
          profitLoss: game.profitLoss
        },
        plays: Object.values(playGroups),
        betCount: bets.length
      }
    });
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
}; 
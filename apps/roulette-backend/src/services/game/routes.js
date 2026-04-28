const express = require('express');
const gameControllers = require('./controllers');
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Game routes
router.post('/start', gameControllers.startGame);
router.patch('/:id/end', gameControllers.endGame);
router.patch('/:id/abandon', gameControllers.abandonGame);
router.get('/', gameControllers.getGameHistory);
router.get('/:id', gameControllers.getGameDetails);

module.exports = router; 
const express = require('express');
const betControllers = require('./controllers');
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// Protect all routes
router.use(protect);

// Bet routes
router.post('/', betControllers.createBets);
router.get('/', betControllers.getBetHistory);
router.get('/stats', betControllers.getBetStats);

module.exports = router; 
const express = require('express');
const gameControllers = require('./controllers');
const { authenticate } = require('../../middleware/authenticate');

const router = express.Router();

router.use(authenticate);
router.post('/start', gameControllers.startGame);
router.patch('/:id/end', gameControllers.endGame);
router.patch('/:id/abandon', gameControllers.abandonGame);
router.get('/', gameControllers.getGameHistory);
router.get('/:id', gameControllers.getGameDetails);

module.exports = router;

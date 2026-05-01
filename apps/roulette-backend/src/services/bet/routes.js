const express = require('express');
const betControllers = require('./controllers');
const { authenticate } = require('../../middleware/authenticate');

const router = express.Router();

router.use(authenticate);
router.post('/', betControllers.createBets);
router.get('/', betControllers.getBetHistory);
router.get('/stats', betControllers.getBetStats);

module.exports = router;

const express = require('express');
const authControllers = require('./controllers');
const { authenticate } = require('../../middleware/authenticate');

const router = express.Router();

router.post('/register', authControllers.register);
router.post('/login', authControllers.login);

router.use(authenticate);
router.get('/me', authControllers.getProfile);
router.patch('/update-profile', authControllers.updateProfile);
router.patch('/update-password', authControllers.updatePassword);

module.exports = router;

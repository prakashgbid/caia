const express = require('express');
const authControllers = require('./controllers');
const { protect } = require('../../middleware/authMiddleware');

const router = express.Router();

// Public routes
router.post('/register', authControllers.register);
router.post('/login', authControllers.login);

// Protected routes
router.use(protect); // All routes after this middleware will be protected
router.get('/me', authControllers.getProfile);
router.patch('/update-profile', authControllers.updateProfile);
router.patch('/update-password', authControllers.updatePassword);

module.exports = router; 
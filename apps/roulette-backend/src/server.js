/**
 * @file server.js
 * @description Main entry point for the Roulette Advisor backend API
 * 
 * This file initializes and configures the Express server for the application, including:
 * - Middleware configuration (CORS, logging, JSON parsing)
 * - Route registration for API endpoints
 * - Database connection to MongoDB
 * - Error handling
 * - Process monitoring
 * 
 * The server implements a modular architecture with separate service routes for:
 * - Authentication (user management)
 * - Game (roulette game state and logic)
 * - Betting (bet tracking and processing)
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const morgan = require('morgan');
const dotenv = require('dotenv');

// Load environment variables from .env file
dotenv.config();

/**
 * Import route handlers from service modules
 * Each service handles a specific domain of the application:
 * - auth: User registration, login, and authentication
 * - game: Game state management, spin results, and game history
 * - bet: Bet placement, validation, and payout calculations
 */
const authRoutes = require('./services/auth/routes');
const gameRoutes = require('./services/game/routes');
const betRoutes = require('./services/bet/routes');

// Initialize Express application
const app = express();
const PORT = process.env.PORT || 5000;

/**
 * Middleware Configuration
 * 
 * - express.json(): Parse JSON request bodies
 * - cors: Handle Cross-Origin Resource Sharing with configurable origin
 * - morgan: HTTP request logging for development and debugging
 */
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGIN, // Allow requests from frontend origin
  credentials: true // Allow credentials (cookies, auth headers)
}));
app.use(morgan('dev')); // Log HTTP requests in development format

/**
 * API Routes Registration
 * 
 * Mount service routers at their respective API endpoints:
 * - /api/auth: Authentication endpoints (register, login, verify)
 * - /api/game: Game management endpoints (create, spin, history)
 * - /api/bets: Betting endpoints (place, cancel, history)
 */
app.use('/api/auth', authRoutes);
app.use('/api/game', gameRoutes);
app.use('/api/bets', betRoutes);

/**
 * Health Check Endpoint
 * 
 * Simple endpoint to verify the API is running
 * Used for monitoring and deployment health checks
 */
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    message: 'Server is running',
    mongodbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

/**
 * Database Connection Options
 * 
 * Configure MongoDB connection with timeout, retry, and pool size options
 * for better reliability and performance across different environments
 */
const mongodbOptions = {
  connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT_MS || '30000'),
  socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT_MS || '30000'),
  maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '50'),
  retryWrites: process.env.MONGODB_RETRY_WRITES === 'true',
};

/**
 * Global Error Handling Middleware
 * 
 * Catches all errors thrown in routes and middleware
 * Returns standardized error response to client
 * Includes stack trace in development mode only
 * 
 * @param {Error} err - The captured error
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || 'Server Error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

/**
 * Database Connection Function
 * 
 * Establishes connection to MongoDB with connection string from environment variables
 * and configured options for optimal performance and reliability
 * 
 * @returns {Promise} Promise resolving to mongoose connection
 */
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, mongodbOptions);
    console.log('MongoDB connected');
    
    // Add event listeners for connection issues
    mongoose.connection.on('error', err => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected, attempting to reconnect...');
    });
    
    mongoose.connection.on('reconnected', () => {
      console.log('MongoDB reconnected');
    });
    
    return mongoose.connection;
  } catch (error) {
    console.error('MongoDB connection error:', error);
    // For serious connection errors, exit the process so container orchestration can restart
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
    throw error;
  }
};

/**
 * Unhandled Promise Rejection Handler
 * 
 * Safety net for any unhandled promise rejections
 * Logs the error and exits the process to prevent silent failures
 * Allows process manager or container orchestrator to restart the service
 */
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED REJECTION! Shutting down...', err);
  // Give the server a chance to close gracefully
  server?.close(() => {
    process.exit(1);
  });
});

/**
 * Server Startup
 * 
 * Connect to database first, then start the server
 * Ensures database is available before accepting requests
 */
let server;

connectDB()
  .then(() => {
    server = app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Health check available at http://localhost:${PORT}/api/health`);
    });
  })
  .catch((err) => {
    console.error('Failed to start server:', err);
  });

// Export app for testing and programmatic imports
module.exports = app; 
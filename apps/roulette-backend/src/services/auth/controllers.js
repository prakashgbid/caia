/**
 * @file controllers.js
 * @description Authentication service controllers
 * 
 * This file contains all the authentication-related controller functions for:
 * - User registration
 * - User login
 * - User profile management
 * - Password management
 * 
 * Each controller handles a specific authentication use case and implements
 * proper validation, error handling, and JWT token management.
 */

const User = require('../../models/User');
const { createSendToken } = require('../../utils/jwtUtils');

/**
 * Register a new user
 * 
 * Creates a new user account with the provided credentials and assigns
 * a default bankroll balance. Validates that the email and username
 * are not already in use before creating the account.
 * 
 * @route POST /api/auth/register
 * @access Public
 * 
 * @param {Object} req.body.email - User's email address
 * @param {Object} req.body.password - User's password (will be hashed)
 * @param {Object} req.body.username - User's chosen username
 * 
 * @returns {Object} JSON response with user data and authentication token
 * @throws {400} If validation fails or user already exists
 */
exports.register = async (req, res) => {
  try {
    const { email, password, username } = req.body;
    
    // Check if email or username already exists
    const existingUser = await User.findOne({ 
      $or: [{ email }, { username }] 
    });
    
    if (existingUser) {
      return res.status(400).json({
        status: 'fail',
        message: 'Email or username already in use'
      });
    }
    
    // Create new user with default starting bankroll
    const newUser = await User.create({
      email,
      password, // Will be hashed by the User model pre-save hook
      username,
      bankroll: 1000 // Default starting bankroll for new players
    });
    
    // Generate JWT token and send response
    createSendToken(newUser, 201, res);
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
};

/**
 * Login user
 * 
 * Authenticates a user with email and password, then issues
 * a JWT token for subsequent authenticated requests.
 * Also updates the user's last login timestamp.
 * 
 * @route POST /api/auth/login
 * @access Public
 * 
 * @param {Object} req.body.email - User's email address
 * @param {Object} req.body.password - User's password
 * 
 * @returns {Object} JSON response with user data and authentication token
 * @throws {400} If email or password is missing
 * @throws {401} If email/password combination is incorrect
 */
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check if email and password are provided
    if (!email || !password) {
      return res.status(400).json({
        status: 'fail',
        message: 'Please provide email and password'
      });
    }
    
    // Find user by email and include password field (normally excluded by default)
    const user = await User.findOne({ email }).select('+password');
    
    // Check if user exists and password is correct using instance method
    if (!user || !(await user.correctPassword(password, user.password))) {
      return res.status(401).json({
        status: 'fail',
        message: 'Incorrect email or password'
      });
    }
    
    // Update last login time for analytics and security
    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });
    
    // Generate JWT token and send response
    createSendToken(user, 200, res);
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
};

/**
 * Get current user profile
 * 
 * Retrieves the profile information for the currently authenticated user.
 * Requires valid JWT token in the authorization header.
 * 
 * @route GET /api/auth/me
 * @access Private - Requires authentication
 * 
 * @returns {Object} JSON response with user profile data
 * @throws {400} If user cannot be found or other error occurs
 * @throws {401} If not authenticated (handled by auth middleware)
 */
exports.getProfile = async (req, res) => {
  try {
    // req.user is set by the protect middleware
    const user = await User.findById(req.user.id);
    
    res.status(200).json({
      status: 'success',
      data: {
        user
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
 * Update user profile
 * 
 * Updates the non-sensitive profile information for the current user.
 * Only allows specific fields to be updated for security purposes.
 * 
 * @route PATCH /api/auth/update-profile
 * @access Private - Requires authentication
 * 
 * @param {Object} req.body - Fields to update (only username and email allowed)
 * 
 * @returns {Object} JSON response with updated user data
 * @throws {400} If validation fails or other error occurs
 * @throws {401} If not authenticated (handled by auth middleware)
 */
exports.updateProfile = async (req, res) => {
  try {
    // Filter out fields that are not allowed to be updated
    // This prevents malicious attempts to modify restricted fields
    const filteredBody = filterObj(req.body, 'username', 'email');
    
    // Update user document with validation
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      filteredBody,
      {
        new: true, // Return the updated document
        runValidators: true // Run validators on update
      }
    );
    
    res.status(200).json({
      status: 'success',
      data: {
        user: updatedUser
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
 * Update user password
 * 
 * Changes the user's password after verifying the current password.
 * Issues a new JWT token after password change for security.
 * 
 * @route PATCH /api/auth/update-password
 * @access Private - Requires authentication
 * 
 * @param {Object} req.body.currentPassword - User's current password
 * @param {Object} req.body.newPassword - User's new password
 * 
 * @returns {Object} JSON response with user data and new authentication token
 * @throws {400} If validation fails or other error occurs
 * @throws {401} If current password is incorrect
 */
exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    
    // Get user with password (password is normally excluded from queries)
    const user = await User.findById(req.user.id).select('+password');
    
    // Verify current password before allowing change
    if (!(await user.correctPassword(currentPassword, user.password))) {
      return res.status(401).json({
        status: 'fail',
        message: 'Your current password is incorrect'
      });
    }
    
    // Update password (hashing happens in the pre-save middleware)
    user.password = newPassword;
    await user.save();
    
    // Generate new token and send response
    // Important to issue a new token after password change
    createSendToken(user, 200, res);
  } catch (error) {
    res.status(400).json({
      status: 'fail',
      message: error.message
    });
  }
};

/**
 * Helper function to filter object properties
 * 
 * Creates a new object containing only the allowed fields
 * from the input object. Used for security to prevent
 * unauthorized field updates.
 * 
 * @param {Object} obj - Source object to filter
 * @param {...String} allowedFields - Fields to allow in the output
 * @returns {Object} New object with only the allowed fields
 */
const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(key => {
    if (allowedFields.includes(key)) {
      newObj[key] = obj[key];
    }
  });
  return newObj;
}; 
const jwt = require('jsonwebtoken');
const { promisify } = require('util');

/**
 * Generate JWT token
 * @param {string} id - User ID
 * @returns {string} JWT token
 */
exports.generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN }
  );
};

/**
 * Verify JWT token
 * @param {string} token - JWT token
 * @returns {Promise<object>} Decoded token payload
 */
exports.verifyToken = async (token) => {
  return await promisify(jwt.verify)(token, process.env.JWT_SECRET);
};

/**
 * Create and send JWT token in response
 * @param {object} user - User object
 * @param {number} statusCode - HTTP status code
 * @param {object} res - Express response object
 */
exports.createSendToken = (user, statusCode, res) => {
  const token = exports.generateToken(user._id);
  
  // Remove password from output
  user.password = undefined;
  
  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user
    }
  });
}; 
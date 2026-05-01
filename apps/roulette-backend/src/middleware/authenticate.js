const User = require('../models/User');
const { verifyToken } = require('../utils/jwtUtils');

exports.authenticate = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return res.status(401).json({ status: 'fail', message: 'You are not logged in. Please log in to get access.' });
    }

    const decoded = await verifyToken(token);

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(401).json({ status: 'fail', message: 'The user belonging to this token no longer exists.' });
    }

    if (user.changedPasswordAfter(decoded.iat)) {
      return res.status(401).json({ status: 'fail', message: 'User recently changed password. Please log in again.' });
    }

    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ status: 'fail', message: 'Authentication failed', error: error.message });
  }
};

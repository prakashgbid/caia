const User = require('../../models/User');
const { createSendToken } = require('../../utils/jwtUtils');
const userProfile = require('../user/profile');

exports.register = async (req, res) => {
  try {
    const { email, password, username } = req.body;

    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      return res.status(400).json({ status: 'fail', message: 'Email or username already in use' });
    }

    const newUser = await User.create({ email, password, username, bankroll: 1000 });
    createSendToken(newUser, 201, res);
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ status: 'fail', message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.correctPassword(password, user.password))) {
      return res.status(401).json({ status: 'fail', message: 'Incorrect email or password' });
    }

    user.lastLogin = Date.now();
    await user.save({ validateBeforeSave: false });
    createSendToken(user, 200, res);
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

exports.getProfile = async (req, res) => {
  try {
    const user = await userProfile.getProfile(req.user.id);
    res.status(200).json({ status: 'success', data: { user } });
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

exports.updateProfile = async (req, res) => {
  try {
    const updatedUser = await userProfile.updateProfile(req.user.id, req.body);
    res.status(200).json({ status: 'success', data: { user: updatedUser } });
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

exports.updatePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.user.id).select('+password');
    if (!(await user.correctPassword(currentPassword, user.password))) {
      return res.status(401).json({ status: 'fail', message: 'Your current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();
    createSendToken(user, 200, res);
  } catch (error) {
    res.status(400).json({ status: 'fail', message: error.message });
  }
};

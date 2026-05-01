const User = require('../../models/User');

const DEFAULT_BANKROLL = 1000;

exports.DEFAULT_BANKROLL = DEFAULT_BANKROLL;

exports.initBalance = async (userId) => {
  return User.findByIdAndUpdate(userId, { bankroll: DEFAULT_BANKROLL }, { new: true });
};

exports.getBalance = async (userId) => {
  const user = await User.findById(userId).select('bankroll');
  if (!user) throw new Error('User not found');
  return user.bankroll;
};

exports.credit = async (userId, amount) => {
  if (amount <= 0) throw new Error('Credit amount must be positive');
  return User.findByIdAndUpdate(userId, { $inc: { bankroll: amount } }, { new: true }).select('bankroll');
};

exports.debit = async (userId, amount) => {
  if (amount <= 0) throw new Error('Debit amount must be positive');
  const user = await User.findById(userId).select('bankroll');
  if (!user) throw new Error('User not found');
  if (user.bankroll < amount) throw new Error('Insufficient bankroll');
  return User.findByIdAndUpdate(userId, { $inc: { bankroll: -amount } }, { new: true }).select('bankroll');
};

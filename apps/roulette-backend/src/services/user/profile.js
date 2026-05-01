const User = require('../../models/User');

const filterObj = (obj, ...allowedFields) => {
  const newObj = {};
  Object.keys(obj).forEach(key => {
    if (allowedFields.includes(key)) newObj[key] = obj[key];
  });
  return newObj;
};

exports.getProfile = async (userId) => {
  return User.findById(userId);
};

exports.updateProfile = async (userId, fields) => {
  const filtered = filterObj(fields, 'username', 'email');
  return User.findByIdAndUpdate(userId, filtered, { new: true, runValidators: true });
};

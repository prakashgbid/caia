// Re-exports for backwards compatibility. Import from authenticate.js / authorize.js directly.
const { authenticate } = require('./authenticate');
const { authorize } = require('./authorize');

exports.protect = authenticate;
exports.restrictTo = authorize;

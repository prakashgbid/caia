// Extends the shared Pokerzeno site ESLint config.
// The framework path is relative; when this template is cloned, update
// the path to point to wherever pokerzeno-framework lives in your workspace.
/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: ['../../pokerzeno-framework/config/eslint.site.js'],
  rules: {
    // Site-specific overrides here
  },
};

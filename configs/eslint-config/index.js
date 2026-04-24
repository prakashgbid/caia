'use strict';

/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended-type-checked',
  ],
  rules: {
    // Boundary rules — enforced as warnings now, errors in v1.0
    'no-restricted-imports': [
      'warn',
      {
        patterns: [
          {
            // Prevent framework/site code from importing CAIA internals directly
            group: ['*/packages/*/src/*'],
            message: 'Import the public API via the package entry point, not internal paths.',
          },
        ],
      },
    ],
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
  },
};

'use strict';

const { FlatCompat } = require('@eslint/eslintrc');
const path = require('path');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: require('@eslint/js').configs.recommended,
});

/** @returns {import('eslint').Linter.FlatConfig[]} */
function createConfig(tsconfigPath) {
  return [
    ...compat.config({
      parser: '@typescript-eslint/parser',
      plugins: ['@typescript-eslint'],
      extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
      ],
      parserOptions: {
        project: tsconfigPath,
      },
      rules: {
        'no-restricted-imports': [
          'warn',
          {
            patterns: [
              {
                group: ['*/packages/*/src/*'],
                message: 'Import the public API via the package entry point, not internal paths.',
              },
            ],
          },
        ],
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        '@typescript-eslint/consistent-type-imports': 'error',
      },
    }),
  ];
}

module.exports = { createConfig };

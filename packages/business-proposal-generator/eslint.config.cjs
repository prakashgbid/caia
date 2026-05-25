'use strict';

const { createConfig } = require('@chiefaia/eslint-config');

const base = createConfig('./tsconfig.test.json');

module.exports = [
  ...base,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'off',
    },
  },
];

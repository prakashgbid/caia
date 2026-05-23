'use strict';

const { createConfig } = require('@chiefaia/eslint-config');

const base = createConfig('./tsconfig.test.json');

// Relax a few strict rules for this package — the JS-recovered sources
// occasionally need explicit `any`, and the test fixtures intentionally
// use `as any` to bypass deep zod-passthrough inference.
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

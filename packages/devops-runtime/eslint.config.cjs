/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');

module.exports = [
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    languageOptions: {
      parser: require('@typescript-eslint/parser'),
      parserOptions: {
        project: path.join(__dirname, 'tsconfig.json'),
        sourceType: 'module',
      },
    },
    rules: {
      'no-console': 'warn',
    },
  },
];

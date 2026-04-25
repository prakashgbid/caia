// @ts-check
// ESLint v9 flat config — replaces .eslintrc.json
// Run: npx eslint src tests

const tseslint = require('typescript-eslint');
const js = require('@eslint/js');

module.exports = tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'no-console': 'off',
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**', 'dashboard/**', 'reports/**'],
  },
);

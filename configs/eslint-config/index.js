'use strict';

const tseslint = require('typescript-eslint');
const eslintJs = require('@eslint/js');

/**
 * Creates a flat ESLint config for CAIA packages.
 * @param {string} [tsconfigPath] - Path to the package's tsconfig.json
 * @returns {import('eslint').Linter.FlatConfig[]}
 */
function createConfig(tsconfigPath) {
  return tseslint.config(
    eslintJs.configs.recommended,
    ...tseslint.configs.recommended,
    {
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
      ...(tsconfigPath ? {
        languageOptions: {
          parserOptions: {
            project: tsconfigPath,
            tsconfigRootDir: process.cwd(),
          },
        },
      } : {}),
    },
  );
}

module.exports = { createConfig };

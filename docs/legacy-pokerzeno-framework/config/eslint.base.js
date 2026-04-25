// Shared ESLint base config — all Pokerzeno repos extend this.
// Usage in any repo: { extends: ['../../pokerzeno-framework/config/eslint.base.js'] }
// (or via @pokerzeno/eslint-config when packaged)
/** @type {import('eslint').Linter.Config} */
module.exports = {
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // TypeScript strict hygiene
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/consistent-type-imports': 'warn',

    // No hard-deletes — use status fields (enforced in review; this rule documents intent)
    'no-restricted-syntax': [
      'warn',
      {
        selector: "CallExpression[callee.property.name='delete']",
        message: 'Prefer soft-delete (status field) over hard deletion.',
      },
    ],

    // Security / injection hygiene
    'no-eval': 'error',
    'no-implied-eval': 'error',
  },
  env: {
    node: true,
    es2022: true,
  },
};

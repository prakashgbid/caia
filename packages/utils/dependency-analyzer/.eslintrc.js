module.exports = {
  root: false,
  rules: {
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_'
      }
    ]
  },
  ignorePatterns: ['dist/', 'node_modules/']
};

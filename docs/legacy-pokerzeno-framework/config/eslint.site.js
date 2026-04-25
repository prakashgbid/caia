// Shared ESLint config for Next.js site repos.
// Usage: { extends: ['../../pokerzeno-framework/config/eslint.site.js'] }
/** @type {import('eslint').Linter.Config} */
module.exports = {
  extends: [
    './eslint.base.js',
    'next/core-web-vitals',
  ],
  rules: {
    // Accessibility: all interactive elements need accessible labels
    'jsx-a11y/anchor-is-valid': 'error',
    'jsx-a11y/alt-text': 'error',
    'jsx-a11y/aria-props': 'error',
    'jsx-a11y/aria-role': 'error',
    'jsx-a11y/role-has-required-aria-props': 'error',
    'jsx-a11y/no-autofocus': 'warn',

    // Brand lock: disallow hardcoded competing brand names in components
    'no-restricted-syntax': [
      'warn',
      {
        selector: "Literal[value=/PokerStars|GGPoker|888poker/i]",
        message: 'Do not reference competitor brand names in component code.',
      },
    ],

    // React
    'react/no-unescaped-entities': 'warn',
    'react/display-name': 'off',
  },
  env: {
    browser: true,
    es2022: true,
  },
};

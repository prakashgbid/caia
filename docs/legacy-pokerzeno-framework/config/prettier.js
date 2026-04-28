// Shared Prettier config — single source of truth for all Pokerzeno repos.
// Usage in package.json: { "prettier": "../../pokerzeno-framework/config/prettier.js" }
// Or in .prettierrc.js: module.exports = require('../../pokerzeno-framework/config/prettier.js');
/** @type {import('prettier').Config} */
module.exports = {
  semi: true,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  bracketSpacing: true,
  endOfLine: 'lf',
  // Tailwind class sorting (requires prettier-plugin-tailwindcss)
  plugins: ['prettier-plugin-tailwindcss'],
};

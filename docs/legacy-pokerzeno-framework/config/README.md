# Shared Config — pokerzeno-framework

Single source of truth for lint, formatting, and TypeScript across all Pokerzeno repos.

## Files

| File | Purpose |
|------|---------|
| `eslint.base.js` | Base ESLint rules for all repos (TS strict, no-eval, soft-delete hint) |
| `eslint.site.js` | Site ESLint (extends base + next/core-web-vitals + a11y + brand-lock) |
| `prettier.js` | Prettier config with Tailwind class sorting |
| `tsconfig.site.json` | Base tsconfig for Next.js site repos |

## Usage in a site repo

**.eslintrc.js**
```js
module.exports = {
  extends: ['../../pokerzeno-framework/config/eslint.site.js'],
};
```

**.prettierrc.js**
```js
module.exports = require('../../pokerzeno-framework/config/prettier.js');
```

**tsconfig.json**
```json
{ "extends": "../../pokerzeno-framework/config/tsconfig.site.json" }
```

## Usage in a plugin package

**.eslintrc.js**
```js
module.exports = {
  extends: ['../../pokerzeno-framework/config/eslint.base.js'],
};
```

The plugins monorepo's `tsconfig.base.json` serves the same role as `tsconfig.site.json` — no duplication needed.

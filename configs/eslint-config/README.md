# @chiefaia/eslint-config

Shared ESLint configuration for all CAIA packages.

## Usage

```bash
pnpm add -D @chiefaia/eslint-config eslint
```

`.eslintrc.cjs`:

```js
module.exports = {
  extends: ['@chiefaia'],
  parserOptions: { project: './tsconfig.json' },
};
```

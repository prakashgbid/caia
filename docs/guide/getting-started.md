# Getting Started

## Installation

Install the CLI globally to scaffold new packages and sites:

```bash
npm install -g @chiefaia/cli
```

## Scaffold a new utility

Inside an existing CAIA monorepo:

```bash
caia new utility my-utility
```

This creates `packages/my-utility/` with:
- `src/index.ts` — typed API stub
- `tests/index.test.ts` — test scaffold
- `package.json`, `tsconfig.json`, `vitest.config.ts` — pre-wired config

## Scaffold a site

```bash
caia new site my-site --domain my-site.com
```

## Audit your repo

```bash
caia doctor
```

## Install individual packages

```bash
pnpm add @chiefaia/logger
pnpm add @chiefaia/errors
pnpm add -D @chiefaia/test-kit
```

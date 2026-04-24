# @chiefaia/tsconfig

Shared TypeScript configuration for all CAIA packages.

## Usage

```bash
pnpm add -D @chiefaia/tsconfig
```

`tsconfig.json`:

```json
{
  "extends": "@chiefaia/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

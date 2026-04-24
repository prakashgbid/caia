# @chiefaia/config

Validated runtime configuration loading for CAIA applications.

## Install

```bash
pnpm add @chiefaia/config
```

## Usage

```ts
import { loadConfig } from '@chiefaia/config';

const config = loadConfig({
  port:    { env: 'PORT',     parse: Number, default: 3000 },
  dbUrl:   { env: 'DATABASE_URL', required: true },
  debug:   { env: 'DEBUG',    parse: (v) => v === 'true', default: false },
});

// config is Readonly<{ port: number; dbUrl: string; debug: boolean }>
```

Throws `ConfigurationError` (from `@chiefaia/errors`) if a required field is missing.

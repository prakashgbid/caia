# @chiefaia/logger

Structured logging for CAIA applications.

## Install

```bash
pnpm add @chiefaia/logger
```

## Usage

```ts
import { createLogger } from '@chiefaia/logger';

const log = createLogger({ name: 'my-service', level: 'info' });

log.info('server started', { port: 3000 });

const reqLog = log.child({ reqId: 'abc123' });
reqLog.debug('handling request');
```

## API

### `createLogger(options: LoggerOptions): Logger`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Logger name, included in every line |
| `level` | `LogLevel` | `'info'` | Minimum level to emit |
| `pretty` | `boolean` | `false` | Pretty-print (dev only) |

### `Logger`

Methods: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `child`.

Each method signature: `(msg: string, ctx?: LogContext) => void`

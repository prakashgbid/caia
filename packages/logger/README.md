# @chiefaia/logger

Structured logging for CAIA applications. Pino-backed; dual-emits ESM (.js)
+ CJS (.cjs) so it can be consumed from both ESM packages and CommonJS apps
in the monorepo.

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
| `redactPaths` | `readonly string[]` | `[]` | Field paths to redact (forwards to pino's `redact.paths`, censor `[REDACTED]`) |
| `onWarnOrError` | `WarnOrErrorHook` | — | Hook fired after every warn/error/fatal log line — see [Bus transport](#bus-transport) below |

### `Logger`

Methods: `trace`, `debug`, `info`, `warn`, `error`, `fatal`, `child`.

Each method signature: `(msg: string, ctx?: LogContext) => void`

`child(bindings: LogContext)` returns a new logger with bindings merged
into every line — use this to thread `correlation_id`, `component`,
`entity_type`, etc. through a request:

```ts
const log = createLogger({ name: 'orchestrator' });
const reqLog = log.child({ component: 'http', correlation_id: 'pr_42' });
reqLog.warn('rate limited', { ip: '1.2.3.4' });
// → {"level":"warn","name":"orchestrator","component":"http","correlation_id":"pr_42","ip":"1.2.3.4","msg":"rate limited"}
```

## Bus transport

Use `busTransport()` to fan every `warn` / `error` / `fatal` log line out
as a `system.error` event on the conductor event bus, without coupling
this package to the bus implementation.

```ts
import { createLogger, busTransport } from '@chiefaia/logger';
import { eventBus } from '@chiefaia/event-bus-internal';

const log = createLogger({
  name: 'orchestrator',
  onWarnOrError: busTransport({ bus: eventBus, actor: 'system' }),
});

log.error('boom', {
  correlation_id: 'pr_42',
  entity_type: 'task',
  entity_id: 'tsk_7',
  component: 'pump',
});
// 1. emits the JSON log line to stdout
// 2. publishes:
//    {
//      type: 'system.error',
//      actor: 'system',
//      severity: 'error',
//      correlation_id: 'pr_42',
//      entity_type: 'task',
//      entity_id: 'tsk_7',
//      payload: { level: 'error', msg: 'boom', logger: 'orchestrator', component: 'pump' }
//    }
```

Severity mapping: `warn` → `warning`, `error`/`fatal` → `error`. The hook
extracts envelope fields (`correlation_id`, `causation_id`, `project_slug`,
`entity_type`, `entity_id`, `domain_slugs`) from the structured fields and
promotes them onto the event; everything else lands inside `payload`.

The bus contract is structural (`LoggerEventBus`) — anything with a
compatible `publish()` method works. For out-of-process services like
`apps/executor`, the bus implementation can simply POST to the
orchestrator's `/events` endpoint:

```ts
const httpBus: LoggerEventBus = {
  publish: (partial) => {
    void fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...partial, timestamp: Date.now() }),
    }).catch(() => { /* observability never breaks the caller */ });
    return undefined;
  },
};
```

Hook errors are swallowed by design — observability must never break the
caller.

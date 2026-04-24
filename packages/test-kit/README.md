# @chiefaia/test-kit

Test utilities, mocks, and fixtures for CAIA packages.

## Install

```bash
pnpm add -D @chiefaia/test-kit
```

## Utilities

| Export | Description |
|--------|-------------|
| `createTestLogger()` | No-op logger — silences output in tests |
| `createSpyLogger()` | Captures log lines for assertions |
| `createTestSecretsClient(values)` | In-memory secrets client pre-loaded with test values |
| `createTestEventBus()` | In-memory event bus (same interface as production) |
| `waitFor(condition, opts)` | Poll until a condition is truthy |

## Example

```ts
import { createSpyLogger, waitFor } from '@chiefaia/test-kit';

const log = createSpyLogger();
myService.init({ logger: log });

await waitFor(() => log.lines.some((l) => l.level === 'info'));
expect(log.lines[0]?.msg).toContain('started');
```

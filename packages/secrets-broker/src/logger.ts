/**
 * Shared `secrets-broker` logger — wraps `@chiefaia/logger` with the
 * broker's default bindings (`component: 'secrets-broker'`) and an HTTP
 * bus transport that POSTs warn/error/fatal lines as `system.error`
 * events back to the orchestrator's /events endpoint.
 *
 * Wiring is opt-in via `BROKER_BUS_URL` (e.g. http://localhost:7776) so
 * the broker stays self-contained when run without a Conductor next to it.
 */
import { createLogger, busTransport, type Logger, type LoggerEventBus } from '@chiefaia/logger';

const BUS_URL = process.env['BROKER_BUS_URL'] ?? '';

const httpBus: LoggerEventBus = {
  publish: (partial) => {
    if (!BUS_URL) return undefined;
    void fetch(`${BUS_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...partial, timestamp: Date.now() }),
    }).catch(() => { /* observability never breaks the caller */ });
    return undefined;
  },
};

export const logger: Logger = createLogger({
  name: 'secrets-broker',
  level: (process.env['BROKER_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
  redactPaths: ['value', '*.value', 'secret', '*.secret'],
  onWarnOrError: BUS_URL ? busTransport({ bus: httpBus, actor: 'secrets-broker' }) : undefined,
});

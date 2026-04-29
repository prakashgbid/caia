/**
 * Shared executor logger — wraps `@chiefaia/logger` with the executor's
 * default bindings (`component: 'executor'`) and a bus transport that POSTs
 * warn/error/fatal lines as `system.error` events back to the orchestrator
 * via the existing /events endpoint.
 *
 * Why route through HTTP rather than the in-process bus: the executor runs
 * out-of-process from the orchestrator API. The orchestrator owns the SQLite
 * outbox; the executor reaches it via fetch (same path as `publish-event.ts`).
 *
 * Use:
 *   import { logger } from './logger';
 *   const log = logger.child({ component: 'daemon', correlation_id });
 *   log.info('starting', { pid });
 */
import { createLogger, busTransport, type Logger, type LoggerEventBus } from '@chiefaia/logger';

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

/**
 * HTTP-bridge implementation of the LoggerEventBus contract — sends events
 * to the orchestrator's /events endpoint. Fire-and-forget; never throws.
 */
const httpBus: LoggerEventBus = {
  publish: (partial) => {
    void fetch(`${ORCHESTRATOR_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...partial,
        timestamp: Date.now(),
      }),
    }).catch(() => { /* swallow — observability must never break the caller */ });
    return undefined;
  },
};

export const logger: Logger = createLogger({
  name: 'executor',
  level: (process.env['EXECUTOR_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
  onWarnOrError: busTransport({
    bus: httpBus,
    actor: 'executor',
  }),
});

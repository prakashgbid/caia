/**
 * Shared worker-coding logger — wraps `@chiefaia/logger` with the worker's
 * default bindings (`component: 'worker-coding'`) and an HTTP bus transport
 * that POSTs warn/error/fatal lines as `system.error` events back to the
 * orchestrator via the `/events` endpoint.
 *
 * Why HTTP rather than the in-process bus: the worker runs out-of-process
 * from the orchestrator API, identical to the executor pattern in
 * `apps/executor/logger.ts` (PR #86 seed). Same fire-and-forget semantics
 * — observability MUST never break the caller.
 *
 * Use:
 *   import { logger } from './logger';
 *   const log = logger.child({ component: 'main', correlation_id });
 *   log.info('booting', { orchestratorUrl });
 */
import { createLogger, busTransport, type Logger, type LoggerEventBus } from '@chiefaia/logger';

const ORCHESTRATOR_URL = process.env['ORCHESTRATOR_URL'] ?? 'http://localhost:7776';

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
    }).catch(() => {
      /* swallow — observability must never break the caller */
    });
    return undefined;
  },
};

export const logger: Logger = createLogger({
  name: 'worker-coding',
  level:
    (process.env['WORKER_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
  onWarnOrError: busTransport({
    bus: httpBus,
    actor: 'worker-coding',
  }),
});

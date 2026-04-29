/**
 * Shared orchestrator logger — wraps `@chiefaia/logger` with the
 * orchestrator's default bindings (`component: <module>`) and an in-process
 * bus transport that publishes warn/error/fatal lines as `system.error`
 * events directly onto the conductor event bus.
 *
 * Use:
 *   import { logger } from '../observability/logger';
 *   const log = logger.child({ component: 'po-agent', correlation_id });
 *   log.info('starting', { promptId });
 */
import { createLogger, busTransport, type Logger, type LoggerEventBus } from '@chiefaia/logger';
import { eventBus } from '../events/bus-adapter';

const wrappedBus: LoggerEventBus = {
  publish: (partial) => {
    try {
      // eventBus.publish wants a typed `actor` enum, but our structural
      // LoggerEventBus contract uses `string` to keep the logger package
      // decoupled from the events taxonomy. The cast is safe — the actor
      // is always one of the known taxonomy values, supplied below.
      eventBus.publish(partial as Parameters<typeof eventBus.publish>[0]);
    } catch {
      // Observability never breaks the caller.
    }
    return undefined;
  },
};

export const logger: Logger = createLogger({
  name: 'orchestrator',
  level: (process.env['ORCHESTRATOR_LOG_LEVEL'] as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info',
  // HARDEN-007: scrub shared secret-shaped paths from every emitted log line.
  includeDefaultRedactPaths: true,
  onWarnOrError: busTransport({
    bus: wrappedBus,
    actor: 'system',
  }),
});

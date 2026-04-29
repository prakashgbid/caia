/**
 * Integration test — logger.warn / .error fan out as `system.error` events
 * on the conductor event bus.
 *
 * This pins the Gate 3 deferred observability polish item: every warn/
 * error/fatal log line emitted via `apps/orchestrator/src/observability/
 * logger.ts` must surface as a queryable `system.error` row in the events
 * outbox, with severity mapped warn→warning and error/fatal→error, and
 * structured fields (correlation_id, entity_type, entity_id, project_slug)
 * promoted onto the envelope so /events?correlation_id=... etc. work.
 */
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { wireEventBus, eventBus } from '../../src/events/bus-adapter';
import { logger as rootLogger } from '../../src/observability/logger';
import { events } from '../../src/db/schema';
import { eq, desc } from 'drizzle-orm';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('observability — logger bus transport', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-logger-bus-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
  });

  afterEach(() => {
    try { fs.unlinkSync(dbPath); } catch { /* best-effort */ }
  });

  it('logger.warn publishes a system.error event with severity=warning', () => {
    const log = rootLogger.child({ component: 'integration-test' });
    log.warn('something is degraded', {
      correlation_id: 'corr-warn-1',
      entity_type: 'prompt',
      entity_id: 'pr_warn',
    });

    const row = getDb()
      .select()
      .from(events)
      .where(eq(events.type, 'system.error'))
      .orderBy(desc(events.occurredAt))
      .get();

    expect(row).toBeDefined();
    expect(row!.type).toBe('system.error');
    expect(row!.severity).toBe('warning');
    expect(row!.actor).toBe('system');
    expect(row!.correlationId).toBe('corr-warn-1');
    expect(row!.entityType).toBe('prompt');
    expect(row!.entityId).toBe('pr_warn');

    const payload = JSON.parse(row!.payloadJson) as Record<string, unknown>;
    expect(payload.level).toBe('warn');
    expect(payload.msg).toBe('something is degraded');
    expect(payload.logger).toBe('orchestrator');
    expect(payload.component).toBe('integration-test');
  });

  it('logger.error publishes a system.error event with severity=error', () => {
    const log = rootLogger.child({ component: 'integration-test', correlation_id: 'corr-err-1' });
    log.error('boom', { entity_id: 'task-err', entity_type: 'task' });

    const row = getDb()
      .select()
      .from(events)
      .where(eq(events.type, 'system.error'))
      .orderBy(desc(events.occurredAt))
      .get();

    expect(row).toBeDefined();
    expect(row!.severity).toBe('error');
    expect(row!.correlationId).toBe('corr-err-1');
    expect(row!.entityId).toBe('task-err');
    const payload = JSON.parse(row!.payloadJson) as Record<string, unknown>;
    expect(payload.level).toBe('error');
    expect(payload.msg).toBe('boom');
  });

  it('logger.info does NOT publish a system.error event', () => {
    const before = getDb().select().from(events).where(eq(events.type, 'system.error')).all().length;
    const log = rootLogger.child({ component: 'integration-test' });
    log.info('routine info', { foo: 'bar' });

    const after = getDb().select().from(events).where(eq(events.type, 'system.error')).all().length;
    expect(after).toBe(before);
  });

  it('logger.fatal publishes severity=error', () => {
    const log = rootLogger.child({ component: 'integration-test', correlation_id: 'corr-fatal-1' });
    log.fatal('catastrophic', { entity_type: 'system' });

    const row = getDb()
      .select()
      .from(events)
      .where(eq(events.type, 'system.error'))
      .orderBy(desc(events.occurredAt))
      .get();

    expect(row).toBeDefined();
    expect(row!.severity).toBe('error');
    const payload = JSON.parse(row!.payloadJson) as Record<string, unknown>;
    expect(payload.level).toBe('fatal');
  });

  it('correlation_id and entity bindings flow from .child() into the event row', () => {
    const log = rootLogger
      .child({ correlation_id: 'corr-chain-1' })
      .child({ component: 'inner' });
    log.error('chained');

    const row = getDb()
      .select()
      .from(events)
      .where(eq(events.type, 'system.error'))
      .orderBy(desc(events.occurredAt))
      .get();

    expect(row!.correlationId).toBe('corr-chain-1');
    const payload = JSON.parse(row!.payloadJson) as Record<string, unknown>;
    expect(payload.component).toBe('inner');
  });

  it('survives a bus failure without throwing — observability never breaks the caller', () => {
    // Wire a broken bus that throws on publish; the logger should swallow.
    const proxied = eventBus as unknown as {
      publish: (...args: unknown[]) => unknown;
    };
    const originalPublish = proxied.publish;
    proxied.publish = () => {
      throw new Error('bus is down');
    };
    const log = rootLogger.child({ component: 'integration-test' });
    expect(() => log.error('still works')).not.toThrow();
    proxied.publish = originalPublish;
  });
});

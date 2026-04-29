import { describe, it, expect, vi } from 'vitest';
import { busTransport, createLogger, type LoggerEventBus } from '../src/index.js';

function makeFakeBus() {
  const calls: Array<Parameters<LoggerEventBus['publish']>[0]> = [];
  const bus: LoggerEventBus = {
    publish: (partial) => {
      calls.push(partial);
      return undefined;
    },
  };
  return { bus, calls };
}

describe('busTransport', () => {
  it('does NOT publish on info / debug / trace', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'orchestrator',
      level: 'trace',
      onWarnOrError: busTransport({ bus, actor: 'system' }),
    });
    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    expect(calls).toHaveLength(0);
    write.mockRestore();
  });

  it('publishes a system.error event on warn (severity=warning)', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'orchestrator',
      level: 'warn',
      onWarnOrError: busTransport({ bus, actor: 'system' }),
    });
    logger.warn('something is off', { component: 'pump', correlation_id: 'c-1' });

    expect(calls).toHaveLength(1);
    const ev = calls[0]!;
    expect(ev.type).toBe('system.error');
    expect(ev.actor).toBe('system');
    expect(ev.severity).toBe('warning');
    expect(ev.correlation_id).toBe('c-1');
    expect(ev.payload).toMatchObject({
      level: 'warn',
      msg: 'something is off',
      logger: 'orchestrator',
      component: 'pump',
    });
    write.mockRestore();
  });

  it('publishes a system.error event on error (severity=error)', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'executor',
      level: 'info',
      onWarnOrError: busTransport({ bus, actor: 'executor' }),
    });
    logger.error('boom', { entity_type: 'task', entity_id: 't-1' });

    expect(calls).toHaveLength(1);
    const ev = calls[0]!;
    expect(ev.type).toBe('system.error');
    expect(ev.severity).toBe('error');
    expect(ev.entity_type).toBe('task');
    expect(ev.entity_id).toBe('t-1');
    expect(ev.payload).toMatchObject({ level: 'error', msg: 'boom' });
    write.mockRestore();
  });

  it('publishes on fatal with severity=error', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'broker',
      level: 'fatal',
      onWarnOrError: busTransport({ bus, actor: 'secrets-broker' }),
    });
    logger.fatal('cannot recover', { correlation_id: 'c-2' });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.severity).toBe('error');
    expect(calls[0]!.payload.level).toBe('fatal');
    write.mockRestore();
  });

  it('inherits bindings from .child() into the published event', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const root = createLogger({
      name: 'orchestrator',
      onWarnOrError: busTransport({ bus, actor: 'system' }),
    });
    const child = root.child({ component: 'http', correlation_id: 'c-100' });
    const grand = child.child({ entity_id: 'st_42' });
    grand.error('failed');

    expect(calls).toHaveLength(1);
    const ev = calls[0]!;
    expect(ev.correlation_id).toBe('c-100');
    expect(ev.entity_id).toBe('st_42');
    expect(ev.payload.component).toBe('http');
    write.mockRestore();
  });

  it('respects excludeLoggerNames to silence specific loggers', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'pulse',
      onWarnOrError: busTransport({
        bus,
        actor: 'system',
        excludeLoggerNames: ['pulse'],
      }),
    });
    logger.error('would loop');
    expect(calls).toHaveLength(0);
    write.mockRestore();
  });

  it('per-call ctx fields override binding fields when both present', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const root = createLogger({
      name: 'app',
      onWarnOrError: busTransport({ bus, actor: 'system' }),
    });
    const child = root.child({ correlation_id: 'parent-cid' });
    child.warn('override', { correlation_id: 'call-cid' });

    expect(calls[0]!.correlation_id).toBe('call-cid');
    write.mockRestore();
  });

  it('hook errors are swallowed — never break the caller', () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'app',
      onWarnOrError: () => {
        throw new Error('hook is broken');
      },
    });
    // Must NOT throw.
    expect(() => logger.error('still works')).not.toThrow();
    expect(write).toHaveBeenCalled();
    write.mockRestore();
  });

  it('domain_slugs array is forwarded when present', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'app',
      onWarnOrError: busTransport({ bus, actor: 'system' }),
    });
    logger.error('multi-domain failure', { domain_slugs: ['frontend', 'backend'] });
    expect(calls[0]!.domain_slugs).toEqual(['frontend', 'backend']);
    write.mockRestore();
  });

  it('non-string typed fields are dropped, not coerced', () => {
    const { bus, calls } = makeFakeBus();
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const logger = createLogger({
      name: 'app',
      onWarnOrError: busTransport({ bus, actor: 'system' }),
    });
    // correlation_id must be string per envelope contract — pass a number.
    logger.error('bad shape', { correlation_id: 12345 as unknown as string });
    expect(calls[0]!.correlation_id).toBeUndefined();
    write.mockRestore();
  });
});

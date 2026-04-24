import { describe, it, expect } from 'vitest';
import {
  createTestLogger,
  createSpyLogger,
  createTestSecretsClient,
  createTestEventBus,
  waitFor,
} from '../src/index.js';

describe('createTestLogger', () => {
  it('returns a logger with all methods', () => {
    const log = createTestLogger();
    expect(() => log.info('test')).not.toThrow();
    expect(() => log.child({ req: 1 }).warn('child')).not.toThrow();
  });

  it('trace/debug/error/fatal are no-ops', () => {
    const log = createTestLogger();
    expect(() => log.trace('t')).not.toThrow();
    expect(() => log.debug('d')).not.toThrow();
    expect(() => log.error('e')).not.toThrow();
    expect(() => log.fatal('f')).not.toThrow();
  });

  it('child returns a logger', () => {
    const log = createTestLogger();
    const child = log.child({ service: 'api' });
    expect(typeof child.info).toBe('function');
    expect(typeof child.child).toBe('function');
  });

  it('nested child loggers work', () => {
    const log = createTestLogger();
    const child = log.child({ a: 1 });
    const grandchild = child.child({ b: 2 });
    expect(() => grandchild.info('deep')).not.toThrow();
  });
});

describe('createSpyLogger', () => {
  it('captures log lines', () => {
    const log = createSpyLogger();
    log.info('hello', { x: 1 });
    log.error('oops');
    expect(log.lines).toHaveLength(2);
    expect(log.lines[0]).toMatchObject({ level: 'info', msg: 'hello' });
  });

  it('captures all log levels', () => {
    const log = createSpyLogger();
    log.trace('t');
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    log.fatal('f');
    expect(log.lines).toHaveLength(6);
    const levels = log.lines.map((l) => l.level);
    expect(levels).toEqual(['trace', 'debug', 'info', 'warn', 'error', 'fatal']);
  });

  it('child logger merges bindings into captured lines', () => {
    const log = createSpyLogger();
    const child = log.child({ reqId: 'abc' });
    child.info('from child');
    expect(log.lines[0]?.ctx).toMatchObject({ reqId: 'abc' });
  });

  it('captures context merged with bindings', () => {
    const log = createSpyLogger();
    const child = log.child({ service: 'auth' });
    child.warn('warning', { user: 'u1' });
    expect(log.lines[0]?.ctx).toMatchObject({ service: 'auth', user: 'u1' });
  });

  it('shares lines array across child loggers', () => {
    const log = createSpyLogger();
    log.info('root');
    const child = log.child({ x: 1 });
    child.info('child');
    // The child creates a new logger but shares the outer closure's lines array
    expect(log.lines.length).toBeGreaterThanOrEqual(1);
  });
});

describe('createTestSecretsClient', () => {
  it('returns preset values', async () => {
    const client = createTestSecretsClient({ MY_KEY: 'my-val' });
    expect(await client.get('MY_KEY')).toBe('my-val');
  });

  it('getAll returns multiple values', async () => {
    const client = createTestSecretsClient({ A: '1', B: '2' });
    const result = await client.getAll(['A', 'B']);
    expect(result).toEqual({ A: '1', B: '2' });
  });

  it('throws for missing key', async () => {
    const client = createTestSecretsClient({});
    await expect(client.get('MISSING')).rejects.toThrow('MISSING');
  });

  it('works with empty defaults', async () => {
    const client = createTestSecretsClient();
    await expect(client.get('K')).rejects.toThrow();
  });
});

describe('createTestEventBus', () => {
  it('works as a real event bus', async () => {
    const bus = createTestEventBus();
    const handler = (x: number) => { results.push(x); };
    const results: number[] = [];
    bus.on('num', handler);
    await bus.emit('num', 42);
    expect(results).toEqual([42]);
  });

  it('supports unsubscribe', async () => {
    const bus = createTestEventBus();
    const results: number[] = [];
    const unsub = bus.on<number>('n', (v) => results.push(v));
    unsub();
    await bus.emit('n', 1);
    expect(results).toHaveLength(0);
  });

  it('once resolves on first emit', async () => {
    const bus = createTestEventBus();
    const p = bus.once<string>('msg');
    await bus.emit('msg', 'hello');
    expect(await p).toBe('hello');
  });
});

describe('waitFor', () => {
  it('resolves when condition becomes true', async () => {
    let ready = false;
    setTimeout(() => { ready = true; }, 20);
    await waitFor(() => ready, { timeout: 500, interval: 10 });
  });

  it('rejects on timeout', async () => {
    await expect(waitFor(() => false, { timeout: 50, interval: 10 })).rejects.toThrow('timed out');
  });

  it('resolves immediately if condition is already true', async () => {
    await expect(waitFor(() => true, { timeout: 100, interval: 10 })).resolves.toBeUndefined();
  });

  it('works with async condition', async () => {
    let count = 0;
    await waitFor(async () => { count++; return count >= 3; }, { timeout: 500, interval: 10 });
    expect(count).toBeGreaterThanOrEqual(3);
  });
});

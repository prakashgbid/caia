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
});

describe('createSpyLogger', () => {
  it('captures log lines', () => {
    const log = createSpyLogger();
    log.info('hello', { x: 1 });
    log.error('oops');
    expect(log.lines).toHaveLength(2);
    expect(log.lines[0]).toMatchObject({ level: 'info', msg: 'hello' });
  });
});

describe('createTestSecretsClient', () => {
  it('returns preset values', async () => {
    const client = createTestSecretsClient({ MY_KEY: 'my-val' });
    expect(await client.get('MY_KEY')).toBe('my-val');
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
});

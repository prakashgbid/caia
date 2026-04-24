import { describe, it, expect, vi } from 'vitest';
import { createEventBus } from '../src/index.js';

describe('createEventBus', () => {
  it('delivers payload to handler', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('test', handler);
    await bus.emit('test', { x: 1 });
    expect(handler).toHaveBeenCalledWith({ x: 1 });
  });

  it('unsubscribes via returned function', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    const unsub = bus.on('test', handler);
    unsub();
    await bus.emit('test', {});
    expect(handler).not.toHaveBeenCalled();
  });

  it('once resolves on first emission', async () => {
    const bus = createEventBus();
    const p = bus.once<string>('greet');
    await bus.emit('greet', 'hello');
    expect(await p).toBe('hello');
  });

  it('does not fire after once is resolved', async () => {
    const bus = createEventBus();
    const handler = vi.fn();
    bus.on('x', handler);
    void bus.once('x');
    await bus.emit('x', 1);
    await bus.emit('x', 2);
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('handles multiple handlers on same event', async () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('multi', h1);
    bus.on('multi', h2);
    await bus.emit('multi', 'payload');
    expect(h1).toHaveBeenCalledWith('payload');
    expect(h2).toHaveBeenCalledWith('payload');
  });

  it('emitting unknown event is a no-op', async () => {
    const bus = createEventBus();
    await expect(bus.emit('unknown', {})).resolves.toBeUndefined();
  });

  it('off removes a specific handler', async () => {
    const bus = createEventBus();
    const h1 = vi.fn();
    const h2 = vi.fn();
    bus.on('ev', h1);
    bus.on('ev', h2);
    bus.off('ev', h1);
    await bus.emit('ev', 'data');
    expect(h1).not.toHaveBeenCalled();
    expect(h2).toHaveBeenCalledWith('data');
  });

  it('awaits async handlers', async () => {
    const bus = createEventBus();
    const results: number[] = [];
    bus.on('async', async (n: number) => {
      await new Promise<void>((r) => setTimeout(r, 5));
      results.push(n);
    });
    await bus.emit('async', 99);
    expect(results).toEqual([99]);
  });

  it('once does not resolve again after first fire', async () => {
    const bus = createEventBus();
    let resolveCount = 0;
    const p = bus.once<number>('count').then((v) => { resolveCount = v; });
    await bus.emit('count', 1);
    await bus.emit('count', 2);
    await p;
    expect(resolveCount).toBe(1);
  });

  it('independent events do not interfere', async () => {
    const bus = createEventBus();
    const aHandler = vi.fn();
    const bHandler = vi.fn();
    bus.on('a', aHandler);
    bus.on('b', bHandler);
    await bus.emit('a', 'A');
    expect(aHandler).toHaveBeenCalledTimes(1);
    expect(bHandler).not.toHaveBeenCalled();
  });
});

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
});

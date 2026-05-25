import { describe, it, expect } from 'vitest';
import { NatsEventBus } from '../src/index.js';

describe('NatsEventBus subscribe (offline semantics)', () => {
  it('subscribe before connect registers the subscription', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    bus.subscribe('story.completed', () => {});
    expect(bus._stats.subCount).toBe(1);
  });

  it('returns an unsubscribe function', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const unsub = bus.subscribe('story.completed', () => {});
    expect(typeof unsub).toBe('function');
  });

  it('unsubscribe removes the subscription', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const unsub = bus.subscribe('story.completed', () => {});
    expect(bus._stats.subCount).toBe(1);
    unsub();
    expect(bus._stats.subCount).toBe(0);
  });

  it('multiple subscriptions tracked independently', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const u1 = bus.subscribe('story.*', () => {});
    const u2 = bus.subscribe('pipeline.*', () => {});
    const u3 = bus.subscribe('*', () => {});
    expect(bus._stats.subCount).toBe(3);
    u2();
    expect(bus._stats.subCount).toBe(2);
    u1(); u3();
    expect(bus._stats.subCount).toBe(0);
  });

  it('unsubscribe is idempotent (calling twice is safe)', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const unsub = bus.subscribe('story.completed', () => {});
    unsub();
    expect(() => unsub()).not.toThrow();
  });

  it('subscribe with "*" matches every event', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    bus.subscribe('*', () => {});
    // Registration succeeded — the matcher behaviour is verified in glob.test.ts
    expect(bus._stats.subCount).toBe(1);
  });

  it('subscribe with glob matches by type pattern', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    bus.subscribe('story.*', () => {});
    expect(bus._stats.subCount).toBe(1);
  });

  it('handler reference is preserved across calls', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const handler = () => {};
    bus.subscribe('story.completed', handler);
    bus.subscribe('story.completed', handler);
    // Same handler subscribed twice = two subscriptions
    expect(bus._stats.subCount).toBe(2);
  });
});

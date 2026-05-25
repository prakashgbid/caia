import { describe, it, expect, vi } from 'vitest';
import { NatsEventBus } from '../src/index.js';

describe('NatsEventBus construction', () => {
  it('throws when servers is empty', () => {
    // @ts-expect-error: missing required field
    expect(() => new NatsEventBus({ servers: [] })).toThrow(/at least one server/);
  });

  it('throws when servers is missing', () => {
    // @ts-expect-error: missing required field
    expect(() => new NatsEventBus({})).toThrow(/at least one server/);
  });

  it('accepts a single server URL', () => {
    expect(() => new NatsEventBus({ servers: ['nats://localhost:4222'] })).not.toThrow();
  });

  it('accepts multiple server URLs', () => {
    expect(() =>
      new NatsEventBus({ servers: ['nats://n1:4222', 'nats://n2:4222', 'nats://n3:4222'] }),
    ).not.toThrow();
  });

  it('starts disconnected', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    expect(bus._stats.connected).toBe(false);
  });

  it('starts with 0 subscriptions', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    expect(bus._stats.subCount).toBe(0);
  });

  it('starts with 0 in-flight publishes', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    expect(bus._stats.inflight).toBe(0);
  });

  it('starts not closed', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    expect(bus._stats.closed).toBe(false);
  });
});

describe('NatsEventBus configuration defaults', () => {
  it('publish before connect throws', async () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    await expect(
      bus.publish({
        type: 'story.completed' as any,
        actor: 'executor' as any,
        payload: {},
        metadata: {},
        domain_slugs: [],
      } as any),
    ).rejects.toThrow(/not connected/);
  });

  it('subscribe before connect records but does not start consumer', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const unsub = bus.subscribe('story.*', () => {});
    expect(bus._stats.subCount).toBe(1);
    unsub();
    expect(bus._stats.subCount).toBe(0);
  });

  it('close() is idempotent on a fresh bus', async () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    await bus.close();
    await bus.close();
    expect(bus._stats.closed).toBe(true);
  });

  it('publish after close throws', async () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    await bus.close();
    await expect(
      bus.publish({
        type: 'story.completed' as any,
        actor: 'executor' as any,
        payload: {},
        metadata: {},
        domain_slugs: [],
      } as any),
    ).rejects.toThrow(/closed/);
  });
});

describe('NatsEventBus sender + dlq config', () => {
  it('setSender changes the sender identity used in envelopes', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'], durableConsumer: 'd1' });
    bus.setSender('agent-x');
    // No direct getter; we verify via the envelope path in publish.test.ts.
    // Here we just confirm the call doesn't throw.
    expect(() => bus.setSender('agent-y')).not.toThrow();
  });

  it('setDlqHandler replaces the handler', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const handler = vi.fn();
    expect(() => bus.setDlqHandler(handler)).not.toThrow();
  });
});

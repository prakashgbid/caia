import { describe, it, expect } from 'vitest';
import { NatsEventBus } from '../src/index.js';
import type { EventBus } from '../src/types.js';

describe('EventBus interface conformance', () => {
  it('NatsEventBus is assignable to EventBus', () => {
    const bus: EventBus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    // existence checks
    expect(typeof bus.publish).toBe('function');
    expect(typeof bus.subscribe).toBe('function');
    expect(typeof bus.replay).toBe('function');
  });

  it('subscribe returns a function (unsubscribe)', () => {
    const bus: EventBus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const u = bus.subscribe('*', () => {});
    expect(typeof u).toBe('function');
  });

  it('replay accepts EventQueryOpts shape', () => {
    const bus: EventBus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    // V1: returns []. The shape is what matters.
    expect(bus.replay({ type: 'story.completed', limit: 10 })).toEqual([]);
  });

  it('replay returns [] in V1 (broker-side replay deferred to v0.2)', () => {
    const bus: EventBus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    expect(bus.replay({})).toEqual([]);
  });

  it('replay accepts every documented opt without throwing', () => {
    const bus: EventBus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    expect(() => bus.replay({
      type: 'x',
      actor: 'executor',
      entityId: 'st_1',
      projectSlug: 'p',
      correlationId: 'c',
      since: '2026-05-25T00:00:00Z',
      limit: 100,
    })).not.toThrow();
  });

  it('matches the @chiefaia/event-bus-internal surface (publish/subscribe/replay)', () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    // The in-process bus has: publish, subscribe, replay, wireDb (DB-specific).
    // Our NATS bus has the first three (wireDb is irrelevant — broker is the store).
    expect('publish' in bus).toBe(true);
    expect('subscribe' in bus).toBe(true);
    expect('replay' in bus).toBe(true);
  });
});

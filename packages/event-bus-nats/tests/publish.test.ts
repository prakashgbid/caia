import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NatsEventBus } from '../src/index.js';
import { decodeEnvelope } from '../src/envelope.js';

/**
 * Publish path tests use a hand-rolled mock JS client injected via
 * private-field reflection. This isolates the envelope/serialisation
 * surface from the network. The integration test exercises a real
 * nats-server.
 */
function attachMockJs(bus: NatsEventBus) {
  const published: Array<{ subject: string; data: Uint8Array; opts: any }> = [];
  const mockJs = {
    publish: vi.fn(async (subject: string, data: Uint8Array, opts: any) => {
      published.push({ subject, data, opts });
      return { seq: published.length };
    }),
  };
  // @ts-expect-error reaching into private state for unit testing
  bus.js = mockJs;
  return { published, mockJs };
}

describe('NatsEventBus.publish — envelope + subject', () => {
  let bus: NatsEventBus;
  beforeEach(() => {
    bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
  });

  it('builds an envelope and publishes to chiefaia.<type>', async () => {
    const { published } = attachMockJs(bus);
    await bus.publish({
      type: 'story.completed' as any,
      actor: 'executor' as any,
      payload: { story_id: 'st_1' },
      metadata: {},
      domain_slugs: [],
    } as any);
    expect(published).toHaveLength(1);
    expect(published[0]!.subject).toBe('chiefaia.story.completed');
  });

  it('returns a fully-inflated ConductorEvent', async () => {
    attachMockJs(bus);
    const ev = await bus.publish({
      type: 'story.completed' as any,
      actor: 'executor' as any,
      payload: { story_id: 'st_1' },
      metadata: {},
      domain_slugs: [],
    } as any);
    expect(ev.id).toMatch(/^ev_/);
    expect(ev.occurred_at).toMatch(/T/);
    expect(ev.severity).toBeTruthy();
  });

  it('decodes the published bytes back into a valid envelope', async () => {
    const { published } = attachMockJs(bus);
    await bus.publish({
      type: 'pipeline.started' as any,
      actor: 'executor' as any,
      payload: { project_slug: 'p1' },
      metadata: {},
      domain_slugs: [],
    } as any);
    const env = decodeEnvelope(published[0]!.data);
    expect(env.schema_version).toBe(1);
    expect(env.event.type).toBe('pipeline.started');
    expect(env.idempotency_key).toMatch(/^ev_/);
  });

  it('uses event.id as msgID for at-least-once dedupe', async () => {
    const { published } = attachMockJs(bus);
    const ev = await bus.publish({
      type: 'story.created' as any,
      actor: 'user' as any,
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as any);
    expect(published[0]!.opts).toEqual({ msgID: ev.id });
  });

  it('stamps sender from durableConsumer by default', async () => {
    bus = new NatsEventBus({ servers: ['nats://localhost:4222'], durableConsumer: 'agent-A' });
    const { published } = attachMockJs(bus);
    await bus.publish({
      type: 'story.created' as any,
      actor: 'user' as any,
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as any);
    const env = decodeEnvelope(published[0]!.data);
    expect(env.sender).toBe('agent-A');
  });

  it('honors setSender override', async () => {
    const { published } = attachMockJs(bus);
    bus.setSender('agent-B');
    await bus.publish({
      type: 'story.created' as any,
      actor: 'user' as any,
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as any);
    const env = decodeEnvelope(published[0]!.data);
    expect(env.sender).toBe('agent-B');
  });

  it('counts in-flight correctly after success', async () => {
    attachMockJs(bus);
    await bus.publish({
      type: 'story.created' as any,
      actor: 'user' as any,
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as any);
    expect(bus._stats.inflight).toBe(0);
  });

  it('decrements in-flight even when publish throws', async () => {
    const failing = { publish: vi.fn(async () => { throw new Error('boom'); }) };
    // @ts-expect-error reach into private
    bus.js = failing;
    await expect(
      bus.publish({
        type: 'story.created' as any,
        actor: 'user' as any,
        payload: {},
        metadata: {},
        domain_slugs: [],
      } as any),
    ).rejects.toThrow(/boom/);
    expect(bus._stats.inflight).toBe(0);
  });

  it('throws backpressure when maxInflight is exceeded', async () => {
    bus = new NatsEventBus({ servers: ['nats://localhost:4222'], maxInflight: 1 });
    // attach a slow mock that lets us push concurrent publishes
    let release: () => void = () => {};
    const slowJs = {
      publish: vi.fn(() => new Promise<void>((r) => { release = r; })),
    };
    // @ts-expect-error reach into private
    bus.js = slowJs;
    const p1 = bus.publish({
      type: 'story.created' as any,
      actor: 'user' as any,
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as any);
    // p1 is now in-flight (inflight=1); the next call should hit backpressure
    await expect(
      bus.publish({
        type: 'story.created' as any,
        actor: 'user' as any,
        payload: {},
        metadata: {},
        domain_slugs: [],
      } as any),
    ).rejects.toThrow(/backpressure/);
    release();
    await p1;
  });
});

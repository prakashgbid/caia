/**
 * Consume-loop retry + DLQ integration tests.
 *
 * These exercise the full handler-throws → nak with backoff → retry →
 * DLQ-republish → ack happy/sad paths by injecting a hand-rolled async
 * iterator into the bus's private `js.consumers.get(...).consume()` shape.
 *
 * The iterator yields successive deliveries of the same envelope with
 * incrementing `redeliveryCount`s so we can deterministically drive the
 * loop through its DLQ branch.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NatsEventBus } from '../src/index.js';
import { encodeEnvelope, wrap } from '../src/envelope.js';
import { decodeEnvelope } from '../src/envelope.js';
import type { ConductorEvent } from '../src/types.js';

interface MockMsg {
  data: Uint8Array;
  ack: ReturnType<typeof vi.fn>;
  nak: ReturnType<typeof vi.fn>;
  info: { redeliveryCount: number };
}

function makeEnvelope(): Uint8Array {
  const ev: ConductorEvent = {
    id: 'ev_test_consume_001',
    type: 'tenant.provisioned' as ConductorEvent['type'],
    occurred_at: '2026-05-25T00:00:00.000Z',
    actor: 'api' as ConductorEvent['actor'],
    domain_slugs: [],
    payload: { tenant_id: 't_1' },
    metadata: {},
    severity: 'info' as ConductorEvent['severity'],
  };
  return encodeEnvelope(wrap(ev, 'test-sender'));
}

function makeMsg(data: Uint8Array, redeliveryCount: number): MockMsg {
  return {
    data,
    ack: vi.fn(),
    nak: vi.fn(),
    info: { redeliveryCount },
  };
}

/** Drive a list of deliveries through a single subscribe handler. */
async function runDeliveries(opts: {
  deliveries: MockMsg[];
  handler: (e: ConductorEvent) => void | Promise<void>;
  ackPolicy?: 'explicit' | 'none';
  maxRetriesBeforeDlq?: number;
  dlqSubject?: string;
}): Promise<{
  publishCalls: Array<{ subject: string; data: Uint8Array; opts: unknown }>;
  deliveries: MockMsg[];
}> {
  const ackPolicy = opts.ackPolicy ?? 'explicit';
  const bus = new NatsEventBus({
    servers: ['nats://localhost:4222'],
    maxRetriesBeforeDlq: opts.maxRetriesBeforeDlq ?? 3,
    dlqSubject: opts.dlqSubject ?? 'chiefaia.events.dlq',
    consumerOverrides: ackPolicy === 'none'
      ? { 'tenant.provisioned': { ackPolicy: 'none' } }
      : undefined,
  });

  const publishCalls: Array<{ subject: string; data: Uint8Array; opts: unknown }> = [];
  const js = {
    publish: vi.fn(async (subject: string, data: Uint8Array, pubOpts: unknown) => {
      publishCalls.push({ subject, data, opts: pubOpts });
      return { seq: publishCalls.length };
    }),
    consumers: {
      get: vi.fn(async () => ({
        consume: vi.fn(async () => ({
          async *[Symbol.asyncIterator]() {
            for (const m of opts.deliveries) yield m;
          },
        })),
      })),
    },
  };
  const jsm = {
    consumers: { add: vi.fn(async () => ({})) },
    streams: { info: vi.fn(async () => ({})), add: vi.fn(async () => ({})) },
  };
  // @ts-expect-error reach into private
  bus.js = js;
  // @ts-expect-error reach into private
  bus.jsm = jsm;

  bus.subscribe('tenant.provisioned', opts.handler);
  // Yield enough times for the consume loop to drain the iterator
  for (let i = 0; i < 10; i++) {
    await new Promise((r) => setImmediate(r));
  }
  return { publishCalls, deliveries: opts.deliveries };
}

describe('consume loop — happy path (explicit ack)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('acks on successful handler', async () => {
    const data = makeEnvelope();
    const deliveries = [makeMsg(data, 0)];
    const { deliveries: d } = await runDeliveries({
      deliveries,
      handler: () => {},
    });
    expect(d[0]!.ack).toHaveBeenCalledTimes(1);
    expect(d[0]!.nak).not.toHaveBeenCalled();
  });

  it('naks (with backoff) on handler throw within retry budget', async () => {
    const data = makeEnvelope();
    const deliveries = [makeMsg(data, 0)]; // first delivery, redeliveryCount=0 → deliveryCount=1
    const { deliveries: d } = await runDeliveries({
      deliveries,
      handler: () => { throw new Error('transient'); },
      maxRetriesBeforeDlq: 3,
    });
    expect(d[0]!.nak).toHaveBeenCalledTimes(1);
    expect(d[0]!.ack).not.toHaveBeenCalled();
    // Nak called with a positive backoff delay
    const arg = d[0]!.nak.mock.calls[0]![0] as number;
    expect(typeof arg).toBe('number');
    expect(arg).toBeGreaterThanOrEqual(0);
  });

  it('keeps nak-ing for deliveries 2 and 3', async () => {
    const data = makeEnvelope();
    const deliveries = [
      makeMsg(data, 1), // deliveryCount=2
      makeMsg(data, 2), // deliveryCount=3
    ];
    const { deliveries: d } = await runDeliveries({
      deliveries,
      handler: () => { throw new Error('still failing'); },
      maxRetriesBeforeDlq: 3,
    });
    expect(d[0]!.nak).toHaveBeenCalledTimes(1);
    expect(d[1]!.nak).toHaveBeenCalledTimes(1);
    expect(d[0]!.ack).not.toHaveBeenCalled();
    expect(d[1]!.ack).not.toHaveBeenCalled();
  });

  it('republishes to DLQ + acks on delivery 4 (retries exhausted)', async () => {
    const data = makeEnvelope();
    const deliveries = [makeMsg(data, 3)]; // deliveryCount=4 > maxRetriesBeforeDlq=3
    const { publishCalls, deliveries: d } = await runDeliveries({
      deliveries,
      handler: () => { throw new Error('poison'); },
      maxRetriesBeforeDlq: 3,
      dlqSubject: 'chiefaia.events.dlq',
    });
    expect(publishCalls).toHaveLength(1);
    expect(publishCalls[0]!.subject).toBe('chiefaia.events.dlq');
    expect(d[0]!.ack).toHaveBeenCalledTimes(1);
    expect(d[0]!.nak).not.toHaveBeenCalled();
    // DLQ envelope carries provenance
    const dlqEnv = decodeEnvelope(publishCalls[0]!.data);
    expect(dlqEnv.dlq).toBeDefined();
    expect(dlqEnv.dlq!.original_subject).toBe('chiefaia.tenant.provisioned');
    expect(dlqEnv.dlq!.delivery_count).toBe(4);
    expect(dlqEnv.dlq!.last_error).toContain('poison');
  });

  it('honors a custom dlqSubject', async () => {
    const data = makeEnvelope();
    const deliveries = [makeMsg(data, 3)];
    const { publishCalls } = await runDeliveries({
      deliveries,
      handler: () => { throw new Error('x'); },
      maxRetriesBeforeDlq: 3,
      dlqSubject: 'my.custom.dlq',
    });
    expect(publishCalls[0]!.subject).toBe('my.custom.dlq');
  });
});

describe('consume loop — ackPolicy=none (worker.heartbeat)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('does NOT ack on success', async () => {
    const data = makeEnvelope();
    const deliveries = [makeMsg(data, 0)];
    const { deliveries: d } = await runDeliveries({
      deliveries,
      handler: () => {},
      ackPolicy: 'none',
    });
    expect(d[0]!.ack).not.toHaveBeenCalled();
    expect(d[0]!.nak).not.toHaveBeenCalled();
  });

  it('does NOT nak on handler throw (drops the message)', async () => {
    const data = makeEnvelope();
    const deliveries = [makeMsg(data, 0)];
    const { deliveries: d, publishCalls } = await runDeliveries({
      deliveries,
      handler: () => { throw new Error('drop me'); },
      ackPolicy: 'none',
    });
    expect(d[0]!.ack).not.toHaveBeenCalled();
    expect(d[0]!.nak).not.toHaveBeenCalled();
    // And never DLQs — these are observability events, dropping is fine.
    expect(publishCalls).toHaveLength(0);
  });

  it('continues processing the next message after a throw', async () => {
    const data = makeEnvelope();
    const deliveries = [
      makeMsg(data, 0),
      makeMsg(data, 0),
      makeMsg(data, 0),
    ];
    let calls = 0;
    await runDeliveries({
      deliveries,
      handler: () => { calls += 1; if (calls === 1) throw new Error('first throws'); },
      ackPolicy: 'none',
    });
    expect(calls).toBe(3);
  });
});

/**
 * Per-event consumer-override tests.
 *
 * Wave 1a pins `worker.heartbeat` to ackPolicy='none' with
 * maxAckPending=1000 (observability firehose; don't pay broker bookkeeping
 * cost per heartbeat). `tenant.provisioned` and `pipeline.stage.advanced`
 * use explicit acks.
 *
 * The override is applied at subscribe time. Bus defaults apply when no
 * override is configured.
 */

import { describe, it, expect, vi } from 'vitest';
import { NatsEventBus } from '../src/index.js';
import {
  WAVE_1A_CONSUMER_OVERRIDES,
  WAVE_1A_EVENT_TYPES,
  isWave1aEvent,
} from '../src/wave1a.js';

interface FakeIter extends AsyncIterable<{
  data: Uint8Array;
  ack(): void;
  nak(delayMs?: number): void;
  info?: { redeliveryCount?: number };
}> {
  stop?(): Promise<void> | void;
}

function makeFakeIter(): FakeIter {
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() { return { value: undefined, done: true }; },
      } as AsyncIterator<{ data: Uint8Array; ack(): void; nak(delayMs?: number): void }>;
    },
    stop() { /* noop */ },
  };
}

/** Attach mock JS + JSM so subscribe() can start a consumer offline. */
function attachMocks(bus: NatsEventBus) {
  const consumerAddCalls: Array<{ stream: string; opts: Record<string, unknown> }> = [];
  const jsm = {
    consumers: {
      add: vi.fn(async (stream: string, opts: Record<string, unknown>) => {
        consumerAddCalls.push({ stream, opts });
        return {};
      }),
    },
    streams: {
      info: vi.fn(async () => ({})),
      add: vi.fn(async () => ({})),
    },
  };
  const js = {
    publish: vi.fn(async () => ({ seq: 1 })),
    consumers: {
      get: vi.fn(async (_stream: string, _durable: string) => ({
        consume: vi.fn(async () => makeFakeIter()),
      })),
    },
  };
  // @ts-expect-error reach into private state
  bus.js = js;
  // @ts-expect-error reach into private state
  bus.jsm = jsm;
  return { consumerAddCalls, jsm, js };
}

describe('Wave 1a constants', () => {
  it('exports the three migrated event types', () => {
    expect(WAVE_1A_EVENT_TYPES).toEqual([
      'tenant.provisioned',
      'worker.heartbeat',
      'pipeline.stage.advanced',
    ]);
  });

  it('isWave1aEvent narrows correctly', () => {
    expect(isWave1aEvent('tenant.provisioned')).toBe(true);
    expect(isWave1aEvent('worker.heartbeat')).toBe(true);
    expect(isWave1aEvent('pipeline.stage.advanced')).toBe(true);
    expect(isWave1aEvent('story.completed')).toBe(false);
    expect(isWave1aEvent('')).toBe(false);
  });

  it('worker.heartbeat override pins ackPolicy=none + maxAckPending=1000', () => {
    const ov = WAVE_1A_CONSUMER_OVERRIDES['worker.heartbeat'];
    expect(ov).toBeDefined();
    expect(ov!.ackPolicy).toBe('none');
    expect(ov!.maxAckPending).toBe(1000);
  });

  it('tenant.provisioned has no override (uses bus defaults = explicit ack)', () => {
    expect(WAVE_1A_CONSUMER_OVERRIDES['tenant.provisioned']).toBeUndefined();
  });

  it('pipeline.stage.advanced has no override (uses bus defaults = explicit ack)', () => {
    expect(WAVE_1A_CONSUMER_OVERRIDES['pipeline.stage.advanced']).toBeUndefined();
  });
});

describe('NatsEventBus consumer overrides — wire-through', () => {
  it('applies worker.heartbeat override on subscribe', async () => {
    const bus = new NatsEventBus({
      servers: ['nats://localhost:4222'],
      consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
    });
    const { consumerAddCalls } = attachMocks(bus);
    bus.subscribe('worker.heartbeat', () => {});
    // Yield once so the async startConsumer can run
    await new Promise((r) => setImmediate(r));
    expect(consumerAddCalls).toHaveLength(1);
    expect(consumerAddCalls[0]!.opts.ack_policy).toBe('none');
    expect(consumerAddCalls[0]!.opts.max_ack_pending).toBe(1000);
  });

  it('applies bus defaults when no override matches', async () => {
    const bus = new NatsEventBus({
      servers: ['nats://localhost:4222'],
      consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
    });
    const { consumerAddCalls } = attachMocks(bus);
    bus.subscribe('tenant.provisioned', () => {});
    await new Promise((r) => setImmediate(r));
    expect(consumerAddCalls[0]!.opts.ack_policy).toBe('explicit');
    // bus-default max_ack_pending = 1024 (from defaultConsumer)
    expect(consumerAddCalls[0]!.opts.max_ack_pending).toBe(1024);
  });

  it('applies bus defaults when override map is absent entirely', async () => {
    const bus = new NatsEventBus({ servers: ['nats://localhost:4222'] });
    const { consumerAddCalls } = attachMocks(bus);
    bus.subscribe('story.completed', () => {});
    await new Promise((r) => setImmediate(r));
    expect(consumerAddCalls[0]!.opts.ack_policy).toBe('explicit');
  });

  it('different subscribes get the right override independently', async () => {
    const bus = new NatsEventBus({
      servers: ['nats://localhost:4222'],
      consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
    });
    const { consumerAddCalls } = attachMocks(bus);
    bus.subscribe('worker.heartbeat', () => {});
    bus.subscribe('tenant.provisioned', () => {});
    await new Promise((r) => setImmediate(r));
    expect(consumerAddCalls).toHaveLength(2);
    const byGlob = Object.fromEntries(
      consumerAddCalls.map((c) => [
        c.opts.filter_subject as string,
        c.opts.ack_policy as string,
      ]),
    );
    expect(byGlob['chiefaia.worker.heartbeat']).toBe('none');
    expect(byGlob['chiefaia.tenant.provisioned']).toBe('explicit');
  });
});

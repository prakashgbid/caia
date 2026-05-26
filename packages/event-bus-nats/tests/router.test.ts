/**
 * HybridEventBus — feature-flag routing tests.
 *
 * The router sits between the legacy in-process bus and NatsEventBus.
 * These tests exercise the routing logic with an in-memory fake legacy
 * bus and a private-field-injected mock JetStream client (same pattern
 * as publish.test.ts).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  HybridEventBus,
  parseFlagCsv,
  BUS_BACKEND_NATS_ENV_VAR,
} from '../src/router.js';
import type { LegacyEventBus } from '../src/router.js';
import type {
  EventHandler,
  PublishInput,
  Unsubscribe,
} from '../src/types.js';
import type { ConductorEvent } from '@chiefaia/events-taxonomy-internal';
import { decodeEnvelope } from '../src/envelope.js';

/** Minimal fake of @chiefaia/event-bus-internal's exported singleton. */
function makeFakeLegacyBus(): LegacyEventBus & {
  published: ConductorEvent[];
  subs: Array<{ glob: string; handler: EventHandler }>;
} {
  const published: ConductorEvent[] = [];
  const subs: Array<{ glob: string; handler: EventHandler }> = [];
  return {
    published,
    subs,
    publish(input: PublishInput): ConductorEvent {
      const ev: ConductorEvent = {
        id: `ev_legacy_${published.length + 1}`,
        occurred_at: '2026-05-25T00:00:00.000Z',
        severity: 'info' as ConductorEvent['severity'],
        ...(input as unknown as ConductorEvent),
      };
      published.push(ev);
      for (const s of subs) {
        if (s.glob === '*' || ev.type === s.glob || ev.type.startsWith(s.glob.replace(/\*$/, ''))) {
          try { void s.handler(ev); } catch { /* swallow */ }
        }
      }
      return ev;
    },
    subscribe(typeGlob: string, handler: EventHandler): Unsubscribe {
      const entry = { glob: typeGlob, handler };
      subs.push(entry);
      return () => {
        const i = subs.indexOf(entry);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    replay(): ConductorEvent[] {
      return [...published];
    },
  };
}

/** Attach a mock JetStream client to the NatsEventBus inside a HybridEventBus. */
function attachMockJsToHybrid(bus: HybridEventBus) {
  const published: Array<{ subject: string; data: Uint8Array; opts: unknown }> = [];
  const mockJs = {
    publish: vi.fn(async (subject: string, data: Uint8Array, opts: unknown) => {
      published.push({ subject, data, opts });
      return { seq: published.length };
    }),
  };
  // @ts-expect-error reaching into private state for unit testing
  bus.natsBus.js = mockJs;
  return { published, mockJs };
}

describe('parseFlagCsv', () => {
  it('returns [] for undefined', () => {
    expect(parseFlagCsv(undefined)).toEqual([]);
  });

  it('returns [] for empty string', () => {
    expect(parseFlagCsv('')).toEqual([]);
  });

  it('returns [] for null', () => {
    expect(parseFlagCsv(null)).toEqual([]);
  });

  it('parses a single value', () => {
    expect(parseFlagCsv('tenant.provisioned')).toEqual(['tenant.provisioned']);
  });

  it('parses comma-separated values', () => {
    expect(parseFlagCsv('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around each value', () => {
    expect(parseFlagCsv(' a , b ,c ')).toEqual(['a', 'b', 'c']);
  });

  it('drops empty segments from trailing commas', () => {
    expect(parseFlagCsv('a,,b,')).toEqual(['a', 'b']);
  });

  it('deduplicates repeated entries', () => {
    expect(parseFlagCsv('a,b,a,c,b')).toEqual(['a', 'b', 'c']);
  });
});

describe('HybridEventBus — construction + flag parsing', () => {
  const originalEnv = process.env[BUS_BACKEND_NATS_ENV_VAR];
  afterEach(() => {
    if (originalEnv === undefined) delete process.env[BUS_BACKEND_NATS_ENV_VAR];
    else process.env[BUS_BACKEND_NATS_ENV_VAR] = originalEnv;
  });

  it('throws when legacyBus is missing', () => {
    expect(
      // @ts-expect-error testing runtime guard
      () => new HybridEventBus({}),
    ).toThrow(/legacyBus is required/);
  });

  it('default-empty flag → no NATS backend, all events route to legacy', () => {
    delete process.env[BUS_BACKEND_NATS_ENV_VAR];
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    expect(hybrid.hasNatsBackend).toBe(false);
    expect(hybrid.natsBus).toBeNull();
    expect(hybrid.routedEventTypes).toEqual([]);
    expect(hybrid.isNatsRouted('tenant.provisioned')).toBe(false);
  });

  it('reads env var when natsRoutedEventTypes not provided', () => {
    process.env[BUS_BACKEND_NATS_ENV_VAR] = 'tenant.provisioned,worker.heartbeat';
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
    });
    expect(hybrid.hasNatsBackend).toBe(true);
    expect(hybrid.routedEventTypes).toEqual(['tenant.provisioned', 'worker.heartbeat']);
    expect(hybrid.isNatsRouted('tenant.provisioned')).toBe(true);
    expect(hybrid.isNatsRouted('worker.heartbeat')).toBe(true);
    expect(hybrid.isNatsRouted('story.completed')).toBe(false);
  });

  it('explicit natsRoutedEventTypes overrides env var', () => {
    process.env[BUS_BACKEND_NATS_ENV_VAR] = 'a,b,c';
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['x', 'y'],
    });
    expect(hybrid.routedEventTypes).toEqual(['x', 'y']);
  });

  it('non-empty flag without natsConfig → no NATS backend, but routedEventTypes is set', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsRoutedEventTypes: ['tenant.provisioned'],
    });
    expect(hybrid.hasNatsBackend).toBe(false);
    // isNatsRouted returns false because there's no NATS backend to route TO
    expect(hybrid.isNatsRouted('tenant.provisioned')).toBe(false);
    // ...but the routed set is still observable for diagnostics
    expect(hybrid.routedEventTypes).toEqual(['tenant.provisioned']);
  });

  it('connect() is a no-op when no NATS backend exists', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    await expect(hybrid.connect()).resolves.toBeUndefined();
    expect(hybrid.isConnected).toBe(true);
  });

  it('connect() is idempotent', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    await hybrid.connect();
    await hybrid.connect();
    expect(hybrid.isConnected).toBe(true);
  });

  it('close() is a no-op when never connected', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    await expect(hybrid.close()).resolves.toBeUndefined();
    expect(hybrid.isConnected).toBe(false);
  });
});

describe('HybridEventBus.publish — routing', () => {
  beforeEach(() => {
    delete process.env[BUS_BACKEND_NATS_ENV_VAR];
  });

  it('routes unflagged events to the legacy bus (sync)', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['tenant.provisioned'],
    });
    const result = hybrid.publish({
      type: 'story.completed' as ConductorEvent['type'],
      actor: 'executor' as ConductorEvent['actor'],
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    // Sync legacy return — not a Promise
    expect(typeof (result as { then?: unknown }).then).toBe('undefined');
    expect(legacy.published).toHaveLength(1);
    expect(legacy.published[0]!.type).toBe('story.completed');
  });

  it('routes flagged events to the NATS bus (async)', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['tenant.provisioned'],
    });
    const { published } = attachMockJsToHybrid(hybrid);
    const ret = hybrid.publish({
      type: 'tenant.provisioned' as ConductorEvent['type'],
      actor: 'api' as ConductorEvent['actor'],
      payload: { tenant_id: 't_1' },
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    expect(ret).toBeInstanceOf(Promise);
    const ev = await (ret as Promise<ConductorEvent>);
    expect(ev.type).toBe('tenant.provisioned');
    expect(published).toHaveLength(1);
    expect(published[0]!.subject).toBe('chiefaia.tenant.provisioned');
    // Legacy did NOT receive it
    expect(legacy.published).toHaveLength(0);
  });

  it('publishes the envelope under chiefaia.<type> on the NATS side', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['pipeline.stage.advanced'],
    });
    const { published } = attachMockJsToHybrid(hybrid);
    await hybrid.publish({
      type: 'pipeline.stage.advanced' as ConductorEvent['type'],
      actor: 'executor' as ConductorEvent['actor'],
      payload: { promptId: 'p1', stage: 'planning' },
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    expect(published[0]!.subject).toBe('chiefaia.pipeline.stage.advanced');
    const env = decodeEnvelope(published[0]!.data);
    expect(env.event.type).toBe('pipeline.stage.advanced');
    expect(env.idempotency_key).toMatch(/^ev_/);
  });

  it('mixed publish stream — each event lands on the correct backend', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['tenant.provisioned', 'worker.heartbeat'],
    });
    const { published } = attachMockJsToHybrid(hybrid);

    hybrid.publish({ type: 'story.completed' as ConductorEvent['type'], actor: 'executor' as ConductorEvent['actor'], payload: {}, metadata: {}, domain_slugs: [] } as PublishInput);
    await hybrid.publish({ type: 'tenant.provisioned' as ConductorEvent['type'], actor: 'api' as ConductorEvent['actor'], payload: {}, metadata: {}, domain_slugs: [] } as PublishInput);
    hybrid.publish({ type: 'story.updated' as ConductorEvent['type'], actor: 'executor' as ConductorEvent['actor'], payload: {}, metadata: {}, domain_slugs: [] } as PublishInput);
    await hybrid.publish({ type: 'worker.heartbeat' as ConductorEvent['type'], actor: 'worker' as ConductorEvent['actor'], payload: {}, metadata: {}, domain_slugs: [] } as PublishInput);

    expect(legacy.published.map((e) => e.type)).toEqual(['story.completed', 'story.updated']);
    expect(published.map((p) => p.subject)).toEqual([
      'chiefaia.tenant.provisioned',
      'chiefaia.worker.heartbeat',
    ]);
  });
});

describe('HybridEventBus.subscribe — dual fan-in', () => {
  beforeEach(() => {
    delete process.env[BUS_BACKEND_NATS_ENV_VAR];
  });

  it('subscribes to both backends and unsubscribes from both', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['tenant.provisioned'],
    });
    const handler: EventHandler = () => {};
    const unsub = hybrid.subscribe('*', handler);
    expect(legacy.subs).toHaveLength(1);
    // @ts-expect-error reach into private for inspection
    expect(hybrid.natsBus!._subs).toHaveLength(1);
    unsub();
    expect(legacy.subs).toHaveLength(0);
    // @ts-expect-error reach into private for inspection
    expect(hybrid.natsBus!._subs).toHaveLength(0);
  });

  it('legacy-side delivery still fires the subscriber even when an event is flagged', () => {
    // This proves the dual-subscribe model: if a publisher OUTSIDE the
    // hybrid bus publishes the flagged event via legacy directly, the
    // subscriber still sees it via the legacy side.
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['tenant.provisioned'],
    });
    attachMockJsToHybrid(hybrid);
    const received: string[] = [];
    hybrid.subscribe('*', (e) => { received.push(e.type); });
    // Direct legacy publish (simulating an unmigrated caller)
    legacy.publish({
      type: 'tenant.provisioned' as ConductorEvent['type'],
      actor: 'api' as ConductorEvent['actor'],
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    expect(received).toEqual(['tenant.provisioned']);
  });

  it('subscribe returns a function (unsubscribe)', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    const unsub = hybrid.subscribe('*', () => {});
    expect(typeof unsub).toBe('function');
  });

  it('degrades to legacy-only when no NATS backend exists', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    const handler: EventHandler = () => {};
    hybrid.subscribe('story.*', handler);
    expect(legacy.subs).toHaveLength(1);
    expect(hybrid.hasNatsBackend).toBe(false);
  });
});

describe('HybridEventBus.replay — defers to legacy', () => {
  it('returns whatever the legacy bus returns', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    legacy.publish({
      type: 'story.completed' as ConductorEvent['type'],
      actor: 'executor' as ConductorEvent['actor'],
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    const back = hybrid.replay({ limit: 10 });
    expect(back).toHaveLength(1);
    expect(back[0]!.type).toBe('story.completed');
  });
});

describe('HybridEventBus.setSender — forwarded to NATS', () => {
  it('no-op when NATS is disabled', () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({ legacyBus: legacy });
    expect(() => hybrid.setSender('test-sender')).not.toThrow();
  });

  it('forwards to the NATS bus when present', async () => {
    const legacy = makeFakeLegacyBus();
    const hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: { servers: ['nats://localhost:4222'] },
      natsRoutedEventTypes: ['tenant.provisioned'],
    });
    const { published } = attachMockJsToHybrid(hybrid);
    hybrid.setSender('agent-X');
    await hybrid.publish({
      type: 'tenant.provisioned' as ConductorEvent['type'],
      actor: 'api' as ConductorEvent['actor'],
      payload: {},
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    const env = decodeEnvelope(published[0]!.data);
    expect(env.sender).toBe('agent-X');
  });
});

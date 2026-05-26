/**
 * Wave 1a end-to-end integration tests against a real NATS JetStream broker.
 *
 * Gated by `NATS_INTEGRATION_URL` — when unset, every case is skipped so
 * local + CI unit runs stay hermetic. CI sets the env var to the broker
 * URL provided by the test-infra workflow (3-replica StatefulSet in the
 * `chiefaia` namespace, JetStream domain `chiefaia`).
 *
 * Each case spins up its own bus with a stream name + durable prefix
 * keyed by the test name so parallel cases don't collide.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  HybridEventBus,
  NatsEventBus,
  WAVE_1A_CONSUMER_OVERRIDES,
  WAVE_1A_EVENT_TYPES,
} from '../../src/index.js';
import type { LegacyEventBus } from '../../src/router.js';
import type {
  ConductorEvent,
  EventHandler,
  PublishInput,
  Unsubscribe,
} from '../../src/types.js';

const NATS_URL = process.env.NATS_INTEGRATION_URL;
const HAS_BROKER = typeof NATS_URL === 'string' && NATS_URL.length > 0;

/** Make a minimal in-memory legacy bus for the hybrid wrapper. */
function makeLegacyBus(): LegacyEventBus & { published: ConductorEvent[] } {
  const subs: Array<{ glob: string; handler: EventHandler }> = [];
  const published: ConductorEvent[] = [];
  return {
    published,
    publish(input: PublishInput): ConductorEvent {
      const ev: ConductorEvent = {
        id: `ev_legacy_${published.length + 1}`,
        occurred_at: new Date().toISOString(),
        severity: 'info' as ConductorEvent['severity'],
        ...(input as unknown as ConductorEvent),
      };
      published.push(ev);
      for (const s of subs) {
        if (s.glob === '*' || s.glob === ev.type) { void s.handler(ev); }
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
    replay() { return [...published]; },
  };
}

describe.skipIf(!HAS_BROKER)('Wave 1a — live NATS round-trip', () => {
  let bus: NatsEventBus;
  beforeAll(async () => {
    bus = new NatsEventBus({
      servers: [NATS_URL as string],
      stream: 'chiefaia-events-it-wave1a',
      durableConsumer: 'wave1a-it',
      consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
    });
    await bus.connect();
  });
  afterAll(async () => {
    await bus.close();
  });

  it.skipIf(!HAS_BROKER)('publishes tenant.provisioned and the subscriber receives it', async () => {
    const received: ConductorEvent[] = [];
    bus.subscribe('tenant.provisioned', (e) => { received.push(e); });
    await bus.publish({
      type: 'tenant.provisioned' as ConductorEvent['type'],
      actor: 'api' as ConductorEvent['actor'],
      payload: { tenant_id: 't_it_1', email: 'it@example.com', schema_name: 'tenant_it', infisical_project_id: 'it_proj' },
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    // Wait for the consumer to deliver
    for (let i = 0; i < 50 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received).toHaveLength(1);
    expect(received[0]!.payload.tenant_id).toBe('t_it_1');
  });

  it.skipIf(!HAS_BROKER)('publishes pipeline.stage.advanced and the subscriber receives it', async () => {
    const received: ConductorEvent[] = [];
    bus.subscribe('pipeline.stage.advanced', (e) => { received.push(e); });
    await bus.publish({
      type: 'pipeline.stage.advanced' as ConductorEvent['type'],
      actor: 'executor' as ConductorEvent['actor'],
      payload: { promptId: 'p_it_1', stage: 'planning', entityKind: 'story', entityId: 's_it_1', durationFromStartMs: 100 },
      metadata: {},
      domain_slugs: [],
    } as PublishInput);
    for (let i = 0; i < 50 && received.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received).toHaveLength(1);
  });

  it.skipIf(!HAS_BROKER)('worker.heartbeat with ackPolicy=none round-trips without ack bookkeeping', async () => {
    const received: ConductorEvent[] = [];
    bus.subscribe('worker.heartbeat', (e) => { received.push(e); });
    for (let i = 0; i < 5; i++) {
      await bus.publish({
        type: 'worker.heartbeat' as ConductorEvent['type'],
        actor: 'worker' as ConductorEvent['actor'],
        payload: { workerId: `w_${i}`, status: 'idle', currentStoryId: null, ts: Date.now() },
        metadata: {},
        domain_slugs: [],
      } as PublishInput);
    }
    for (let i = 0; i < 50 && received.length < 5; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received.length).toBeGreaterThanOrEqual(5);
  });
});

describe.skipIf(!HAS_BROKER)('Wave 1a — HybridEventBus end-to-end', () => {
  let hybrid: HybridEventBus;
  let legacy: ReturnType<typeof makeLegacyBus>;
  beforeAll(async () => {
    legacy = makeLegacyBus();
    hybrid = new HybridEventBus({
      legacyBus: legacy,
      natsConfig: {
        servers: [NATS_URL as string],
        stream: 'chiefaia-events-it-hybrid',
        durableConsumer: 'wave1a-hybrid-it',
        consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
      },
      natsRoutedEventTypes: [...WAVE_1A_EVENT_TYPES],
    });
    await hybrid.connect();
  });
  afterAll(async () => {
    await hybrid.close();
  });

  it.skipIf(!HAS_BROKER)('routes flagged events to NATS and unflagged to legacy', async () => {
    const received: string[] = [];
    hybrid.subscribe('*', (e) => { received.push(e.type); });

    // Flagged → NATS round-trip
    await hybrid.publish({
      type: 'tenant.provisioned' as ConductorEvent['type'],
      actor: 'api' as ConductorEvent['actor'],
      payload: { tenant_id: 't_h_1' },
      metadata: {},
      domain_slugs: [],
    } as PublishInput);

    // Unflagged → legacy sync
    hybrid.publish({
      type: 'story.completed' as ConductorEvent['type'],
      actor: 'executor' as ConductorEvent['actor'],
      payload: { story_id: 'st_h_1' },
      metadata: {},
      domain_slugs: [],
    } as PublishInput);

    for (let i = 0; i < 50 && received.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(received).toContain('tenant.provisioned');
    expect(received).toContain('story.completed');
    expect(legacy.published.map((e) => e.type)).toEqual(['story.completed']);
  });
});

/**
 * Integration test: real nats-server, real round-trip.
 *
 * This test is skipped unless `NATS_INTEGRATION_URL` is set. CI is
 * expected to start a nats-server (testcontainers or service
 * container) and inject the URL. To run locally:
 *
 *   nats-server -js -p 4222 &
 *   NATS_INTEGRATION_URL=nats://localhost:4222 pnpm test:integration
 *
 * For an authenticated TLS broker (production / K3s), also set:
 *   NATS_NKEY_SEED       — raw NKey user seed string (preferred), OR
 *   NATS_USER_NK_PATH    — path to a file containing the seed on line 1
 *   NATS_CA_PATH         — path to the CA certificate (.crt / .pem)
 *   NATS_TLS_INSECURE=1  — skip cert hostname verification (test only)
 */

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NatsEventBus } from '../../src/index.js';
import type { NatsEventBusConfig } from '../../src/index.js';

const URL = process.env.NATS_INTEGRATION_URL;
const skip = !URL;

function resolveSeed(): string | undefined {
  if (process.env.NATS_NKEY_SEED) return process.env.NATS_NKEY_SEED.trim();
  if (process.env.NATS_USER_NK_PATH) {
    const content = readFileSync(process.env.NATS_USER_NK_PATH, 'utf8');
    return content.split(/\r?\n/)[0]!.trim();
  }
  return undefined;
}

function buildConfig(durable: string): NatsEventBusConfig {
  const base: NatsEventBusConfig = {
    servers: [URL!],
    stream: 'integration-events',
    subjectPrefix: 'integration',
    durableConsumer: durable,
  };
  const seed = resolveSeed();
  if (seed) base.auth = { nkeySeed: seed };
  if (process.env.NATS_CA_PATH || process.env.NATS_TLS_INSECURE) {
    base.tls = {
      caFile: process.env.NATS_CA_PATH,
      rejectUnauthorized: process.env.NATS_TLS_INSECURE === '1' ? false : true,
    };
  }
  return base;
}

describe.skipIf(skip)('NATS round-trip (real broker)', () => {
  let pub: NatsEventBus;
  let sub: NatsEventBus;

  beforeAll(async () => {
    pub = new NatsEventBus(buildConfig('integration-pub'));
    sub = new NatsEventBus(buildConfig('integration-sub'));
    await pub.connect();
    await sub.connect();
  }, 30_000);

  afterAll(async () => {
    if (pub) await pub.close();
    if (sub) await sub.close();
  }, 30_000);

  it('publishes from one client and receives on another', async () => {
    const received: any[] = [];
    sub.subscribe('story.completed', (ev) => {
      received.push(ev);
    });

    // Tiny delay to let the consumer initialise
    await new Promise((r) => setTimeout(r, 500));

    const published = await pub.publish({
      type: 'story.completed' as any,
      actor: 'executor' as any,
      payload: { story_id: 'integration-1' },
      metadata: {},
      domain_slugs: [],
    } as any);

    // Wait for delivery
    const start = Date.now();
    while (received.length === 0 && Date.now() - start < 10_000) {
      await new Promise((r) => setTimeout(r, 100));
    }

    expect(received).toHaveLength(1);
    expect(received[0]!.id).toBe(published.id);
    expect(received[0]!.type).toBe('story.completed');
    expect((received[0]!.payload as any).story_id).toBe('integration-1');
  }, 30_000);
});

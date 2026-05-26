// REUSE-FIRST EXCEPTION: short-lived duplicate, refactor to shared package tracked at follow-up B-task
// TODO(ADR): short-lived duplication of apps/wizard/lib/auth + lib/tenants until the shared `@chiefaia/wizard-auth` package lands (B-task tracked in PLAN.md §7).
/**
 * Server-only wiring for the tenant store / provisioner. Constructs the
 * pg.Pool + Infisical config + NATS publisher singletons from env.
 *
 * Imported only from server modules (middleware, route handlers). The
 * client bundle never sees this file because none of its exports are
 * referenced from a `'use client'` module.
 *
 * Wave 1a (2026-05-25):
 *   1. The publisher is now a `HybridEventBus` from
 *      `@chiefaia/event-bus-nats` so this app participates in the
 *      `BUS_BACKEND_NATS_FOR_EVENT_TYPES` feature flag the same way the
 *      orchestrator does.
 *   2. Fixed a swallowed-publish bug from the V1 skeleton: the bus is
 *      now connected on first use (lazily) and any connect failure is
 *      surfaced. Previously the wire layer constructed `NatsEventBus`
 *      but never called `connect()`, so every publish threw and was
 *      eaten by provisionTenant's try/catch.
 *   3. The connection is established lazily on the first publish to
 *      avoid forcing edge-runtime middleware to pay the connect cost
 *      on cold start. Subsequent publishes reuse the singleton.
 */

import { Pool } from 'pg';
import {
  HybridEventBus,
  WAVE_1A_CONSUMER_OVERRIDES,
  WAVE_1A_EVENT_TYPES,
} from '@chiefaia/event-bus-nats';
import { eventBus as legacyBus } from '@chiefaia/event-bus-internal';
import { TenantStore } from './store';
import type { EventPublisher, ProvisionDeps } from './provision';
import type { InfisicalProvisionOptions } from './infisical';

let cachedPool: Pool | null = null;
let cachedDeps: ProvisionDeps | null = null;
let cachedHybridBus: HybridEventBus | null = null;
let connectPromise: Promise<void> | null = null;

export function getPool(): Pool {
  if (!cachedPool) {
    cachedPool = new Pool({
      connectionString: process.env.GLOBAL_POSTGRES_URL,
      max: 5,
    });
  }
  return cachedPool;
}

export function getInfisicalOptions(): InfisicalProvisionOptions {
  return {
    baseUrl: process.env.INFISICAL_BASE_URL ?? 'https://infisical.chiefaia.com',
    adminToken: process.env.INFISICAL_ADMIN_TOKEN ?? '',
    organizationId: process.env.INFISICAL_ORG_ID ?? '',
  };
}

/**
 * Construct (or return cached) the HybridEventBus. The bus reads
 * `BUS_BACKEND_NATS_FOR_EVENT_TYPES` from env at construction time and
 * routes only those events to NATS — every other event stays on the
 * legacy in-process bus exactly as before.
 *
 * For the dashboard middleware path, the env should at minimum include
 * `tenant.provisioned` once the operator is ready to flip the flag.
 * Default (empty) keeps the V1 skeleton behavior: no NATS connection
 * is opened.
 */
export function getHybridBus(): HybridEventBus {
  if (cachedHybridBus) return cachedHybridBus;
  cachedHybridBus = new HybridEventBus({
    legacyBus,
    natsConfig: {
      servers: (process.env.NATS_SERVERS ?? 'nats://nats.chiefaia.com:4222').split(','),
      stream: process.env.NATS_STREAM ?? 'chiefaia-events',
      subjectPrefix: process.env.NATS_SUBJECT_PREFIX ?? 'chiefaia',
      durableConsumer: process.env.NATS_DURABLE ?? 'chiefaia-dashboard',
      consumerOverrides: WAVE_1A_CONSUMER_OVERRIDES,
      auth: process.env.NATS_NKEY_SEED ? { nkeySeed: process.env.NATS_NKEY_SEED } : undefined,
      tls: process.env.NATS_TLS_CA ? {
        caFile: process.env.NATS_TLS_CA,
        certFile: process.env.NATS_TLS_CERT,
        keyFile: process.env.NATS_TLS_KEY,
      } : undefined,
    },
    // Allow ops to roll the flag forward independently of code; default-empty
    // means HybridEventBus skips the NATS construction entirely.
  });
  return cachedHybridBus;
}

/**
 * Lazily-connected publisher adapter. The first publish opens the NATS
 * connection (if any events are routed); subsequent publishes reuse it.
 *
 * Connection errors are SURFACED to the caller via a rejected promise —
 * the V1 skeleton's silent failure mode is gone. provisionTenant's own
 * try/catch decides whether a publish failure should block the response
 * (currently: no, but the error is logged with a real reason now).
 */
async function getPublisher(): Promise<EventPublisher> {
  const bus = getHybridBus();
  if (!connectPromise) {
    connectPromise = bus.connect().catch((err) => {
      // Reset so a subsequent publish can retry
      connectPromise = null;
      throw err;
    });
  }
  await connectPromise;
  // HybridEventBus.publish returns Promise<ConductorEvent> | ConductorEvent;
  // EventPublisher's contract takes a single arg and returns Promise<unknown>.
  return {
    publish: async (input) => bus.publish(input as Parameters<HybridEventBus['publish']>[0]),
  };
}

export async function getProvisionDeps(): Promise<ProvisionDeps> {
  if (cachedDeps) return cachedDeps;
  const pool = getPool();
  cachedDeps = {
    pool,
    tenantStore: new TenantStore({ pool }),
    infisical: getInfisicalOptions(),
    publisher: await getPublisher(),
  };
  return cachedDeps;
}

/** Test-only — reset the cached singletons. */
export function __resetWireCache(): void {
  cachedPool = null;
  cachedDeps = null;
  cachedHybridBus = null;
  connectPromise = null;
}

/** Test-only — list of event types this app will route to NATS. */
export function __routedEventTypesForTests(): readonly string[] {
  return WAVE_1A_EVENT_TYPES;
}

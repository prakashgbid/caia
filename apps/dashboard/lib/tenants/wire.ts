/**
 * Server-only wiring for the tenant store / provisioner. Constructs the
 * pg.Pool + Infisical config + NATS publisher singletons from env.
 *
 * Imported only from server modules (middleware, route handlers). The
 * client bundle never sees this file because none of its exports are
 * referenced from a `'use client'` module.
 */

import { Pool } from 'pg';
import { TenantStore } from './store';
import type { EventPublisher, ProvisionDeps } from './provision';
import type { InfisicalProvisionOptions } from './infisical';

let cachedPool: Pool | null = null;
let cachedDeps: ProvisionDeps | null = null;

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
 * Lazily-constructed NATS publisher. We import the class dynamically so
 * tree-shaking can drop it on the edge-runtime middleware path when the
 * publisher isn't actually called.
 */
async function getPublisher(): Promise<EventPublisher> {
  const { NatsEventBus } = await import('@chiefaia/event-bus-nats');
  const bus = new (NatsEventBus as unknown as new (cfg: {
    servers: string[];
    stream: string;
  }) => EventPublisher)({
    servers: (process.env.NATS_SERVERS ?? 'nats://nats.chiefaia.com:4222').split(','),
    stream: process.env.NATS_STREAM ?? 'CONDUCTOR_EVENTS',
  });
  return bus;
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
}

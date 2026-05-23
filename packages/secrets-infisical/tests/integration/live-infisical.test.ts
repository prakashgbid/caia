/**
 * Live-server integration test for `@caia/secrets-infisical`.
 *
 * Skipped unless every required env var is set. To run:
 *
 *   export INFISICAL_URL=https://infisical.chiefaia.com
 *   export INFISICAL_CLIENT_ID=...
 *   export INFISICAL_CLIENT_SECRET=...
 *   export INFISICAL_TEST_WORKSPACE_ID=...
 *   # optional, when behind Cloudflare Access:
 *   export CF_ACCESS_CLIENT_ID=...
 *   export CF_ACCESS_CLIENT_SECRET=...
 *
 *   pnpm test:integration
 *
 * Test data lives under `/caia-secrets-postgres-itest/`, prefixed with
 * a UUID so concurrent runs don't collide. The suite cleans up after
 * itself; if it doesn't, the path prefix makes orphans trivial to spot.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  ConfigMapProjectResolver,
  InMemoryAuditLogger,
  InfisicalSecretsAdapter,
} from '../../src/index.js';
import type { AccessContext } from '@caia/secrets-adapter';

const url = process.env['INFISICAL_URL'];
const clientId = process.env['INFISICAL_CLIENT_ID'];
const clientSecret = process.env['INFISICAL_CLIENT_SECRET'];
const workspaceId = process.env['INFISICAL_TEST_WORKSPACE_ID'];
const cfClientId = process.env['CF_ACCESS_CLIENT_ID'];
const cfClientSecret = process.env['CF_ACCESS_CLIENT_SECRET'];

const skip = !url || !clientId || !clientSecret || !workspaceId;
const d = skip ? describe.skip : describe;

const tenantId = `itest-${randomUUID().slice(0, 8)}`;
const category = `caia-secrets-infisical-itest`;
const ctx: AccessContext = {
  callerType: 'system',
  callerId: 'vitest-integration',
  reason: 'live infisical integration test',
};

let adapter: InfisicalSecretsAdapter;
let audit: InMemoryAuditLogger;

d('@caia/secrets-infisical — live integration', () => {
  beforeAll(() => {
    audit = new InMemoryAuditLogger();
    adapter = new InfisicalSecretsAdapter({
      baseUrl: url!,
      auth: {
        type: 'universal-auth',
        clientId: clientId!,
        clientSecret: clientSecret!,
      },
      ...(cfClientId && cfClientSecret
        ? {
            cloudflareAccess: {
              clientId: cfClientId,
              clientSecret: cfClientSecret,
            },
          }
        : {}),
      projectResolver: new ConfigMapProjectResolver({
        [tenantId]: workspaceId!,
      }),
      auditLogger: audit,
    });
  });

  afterAll(async () => {
    try {
      await adapter?.deleteAllForTenant(tenantId);
    } catch {
      // best effort
    }
  });

  it('pings the live host', async () => {
    const r = await adapter.ping();
    expect(r.backend).toBe('infisical');
  });

  it('round-trips a secret end-to-end', async () => {
    const value = `secret-${randomUUID()}`;
    const put = await adapter.put(tenantId, category, 'itest-key', value);
    expect(put.secretRef).toBeTruthy();
    const got = await adapter.get(tenantId, category, 'itest-key', ctx);
    expect(got).toBe(value);
  });

  it('lists the secret we just wrote', async () => {
    const list = await adapter.list(tenantId, category);
    expect(list.find((m) => m.key === 'itest-key')).toBeTruthy();
  });

  it('replaces a value with replace=true', async () => {
    const v2 = `secret-${randomUUID()}`;
    await adapter.put(tenantId, category, 'itest-key', v2, { replace: true });
    expect(await adapter.get(tenantId, category, 'itest-key', ctx)).toBe(v2);
  });

  it('deleteAllForTenant cleans up', async () => {
    const r = await adapter.deleteAllForTenant(tenantId);
    expect(r.deletedCount).toBeGreaterThanOrEqual(1);
  });
});

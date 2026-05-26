/**
 * provisionTenant() — idempotency + fan-out tests.
 *
 * We stub every external (Pool, TenantStore, infisical fetch, publisher)
 * and verify orchestration order + side-effect gating.
 */

import { describe, it, expect, vi } from 'vitest';
import { provisionTenant, ensureTenantSchema } from '../../lib/tenants/provision';
import type { Pool } from 'pg';

const TENANT_ROW = {
  tenantId: 't-1',
  email: 'a@b.com',
  displayName: 'A',
  schemaName: 'tenant_a_b_com_x',
  infisicalProjectId: 'inf-1',
  createdAtIso: '2026-05-25T10:00:00.000Z',
};

function fakePool(executed: string[]): Pool {
  return {
    query: vi.fn(async (sql: string) => {
      executed.push(sql);
      return { rows: [] };
    }),
  } as unknown as Pool;
}

function fakeStore(opts: { findResult: typeof TENANT_ROW | null; insertCreated: boolean }) {
  return {
    findByEmail: vi.fn(async () => opts.findResult),
    insertIfAbsent: vi.fn(async () => ({ tenant: TENANT_ROW, created: opts.insertCreated })),
  };
}

function fakeInfisical() {
  return {
    baseUrl: 'https://infisical.test',
    adminToken: 'token',
    organizationId: 'org-1',
    fetchImpl: vi.fn(async () =>
      new Response(JSON.stringify({ workspace: { _id: 'inf-1', name: 'tenant-t-1' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch,
  };
}

function fakePublisher() {
  return { publish: vi.fn(async () => ({ id: 'ev-1' })) };
}

describe('provisionTenant', () => {
  it('returns existing tenant unchanged (idempotent fast-path)', async () => {
    const executed: string[] = [];
    const store = fakeStore({ findResult: TENANT_ROW, insertCreated: false });
    const publisher = fakePublisher();
    const r = await provisionTenant('a@b.com', 'A', {
      pool: fakePool(executed),
      tenantStore: store as never,
      infisical: fakeInfisical(),
      publisher,
      newId: () => 't-1',
    });
    expect(r.created).toBe(false);
    expect(r.tenant.tenantId).toBe('t-1');
    expect(store.insertIfAbsent).not.toHaveBeenCalled();
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(executed).toEqual([]);
  });

  it('creates schema, calls infisical, inserts, publishes for a new tenant', async () => {
    const executed: string[] = [];
    const store = fakeStore({ findResult: null, insertCreated: true });
    const infisical = fakeInfisical();
    const publisher = fakePublisher();
    const r = await provisionTenant('new@user.com', 'New', {
      pool: fakePool(executed),
      tenantStore: store as never,
      infisical,
      publisher,
      newId: () => 't-1',
    });
    expect(r.created).toBe(true);
    expect(executed.some((s) => s.includes('CREATE SCHEMA'))).toBe(true);
    expect(infisical.fetchImpl).toHaveBeenCalled();
    expect(store.insertIfAbsent).toHaveBeenCalledOnce();
    expect(publisher.publish).toHaveBeenCalledOnce();
    const firstCall = publisher.publish.mock.calls[0] as unknown as [{ type: string }];
    expect(firstCall[0].type).toBe('tenant.provisioned');
  });

  it('does NOT publish when insert was a no-op (concurrent writer lost race)', async () => {
    const executed: string[] = [];
    const store = fakeStore({ findResult: null, insertCreated: false });
    const publisher = fakePublisher();
    await provisionTenant('race@user.com', 'Race', {
      pool: fakePool(executed),
      tenantStore: store as never,
      infisical: fakeInfisical(),
      publisher,
      newId: () => 't-1',
    });
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('rejects malformed emails', async () => {
    await expect(
      provisionTenant('not-an-email', 'X', {
        pool: fakePool([]),
        tenantStore: fakeStore({ findResult: null, insertCreated: true }) as never,
        infisical: fakeInfisical(),
        publisher: fakePublisher(),
      }),
    ).rejects.toThrow(/invalid email/);
  });

  it('rejects empty email', async () => {
    await expect(
      provisionTenant('   ', 'X', {
        pool: fakePool([]),
        tenantStore: fakeStore({ findResult: null, insertCreated: true }) as never,
        infisical: fakeInfisical(),
        publisher: fakePublisher(),
      }),
    ).rejects.toThrow(/invalid email/);
  });

  it('swallows publisher errors so the response is not blocked', async () => {
    const store = fakeStore({ findResult: null, insertCreated: true });
    const publisher = {
      publish: vi.fn(async () => {
        throw new Error('NATS down');
      }),
    };
    const r = await provisionTenant('a@b.com', 'A', {
      pool: fakePool([]),
      tenantStore: store as never,
      infisical: fakeInfisical(),
      publisher,
    });
    expect(r.created).toBe(true);
    expect(publisher.publish).toHaveBeenCalled();
  });
});

describe('ensureTenantSchema', () => {
  it('issues a CREATE SCHEMA IF NOT EXISTS for the given name', async () => {
    const calls: string[] = [];
    await ensureTenantSchema(
      { query: async (sql: string) => calls.push(sql) } as unknown as Pool,
      'tenant_abc',
    );
    expect(calls[0]).toContain('CREATE SCHEMA IF NOT EXISTS');
    expect(calls[0]).toContain('tenant_abc');
  });

  it('strips stray double-quotes from the schema name (defence-in-depth)', async () => {
    const calls: string[] = [];
    await ensureTenantSchema(
      { query: async (sql: string) => calls.push(sql) } as unknown as Pool,
      'tenant"injection"',
    );
    expect(calls[0]).not.toMatch(/tenant".+"injection/);
  });
});

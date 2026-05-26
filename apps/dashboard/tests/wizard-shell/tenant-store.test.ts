/**
 * TenantStore tests with a fake `pg.Pool` — covers find, insert, conflict
 * resolution, schema-name derivation determinism.
 */

import { describe, it, expect, vi } from 'vitest';
import { TenantStore, schemaNameForEmail } from '../../lib/tenants/store';
import type { Pool } from 'pg';

interface FakeQuery {
  rows: Array<Record<string, unknown>>;
}
function fakePool(impl: (sql: string, params: unknown[]) => Promise<FakeQuery>): Pool {
  return { query: (sql: string, params: unknown[]) => impl(sql, params) } as unknown as Pool;
}

const ROW = {
  tenant_id: 't-1',
  email: 'a@b.com',
  display_name: 'A',
  schema_name: 'tenant_a_b_com_1234abcd',
  infisical_project_id: 'inf-1',
  created_at: new Date('2026-05-25T10:00:00Z'),
};

describe('TenantStore', () => {
  it('findByEmail returns row when present (and lowercases email)', async () => {
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    const store = new TenantStore({
      pool: fakePool(async (sql, params) => {
        queries.push({ sql, params });
        return { rows: [ROW] };
      }),
    });
    const t = await store.findByEmail('A@B.com');
    expect(t?.tenantId).toBe('t-1');
    expect(queries[0]?.params[0]).toBe('a@b.com');
  });

  it('findByEmail returns null when no row', async () => {
    const store = new TenantStore({
      pool: fakePool(async () => ({ rows: [] })),
    });
    expect(await store.findByEmail('x@y.com')).toBeNull();
  });

  it('insertIfAbsent returns created=true when the INSERT yielded a row', async () => {
    const store = new TenantStore({
      pool: fakePool(async () => ({ rows: [ROW] })),
    });
    const r = await store.insertIfAbsent({
      tenantId: 't-1',
      email: 'a@b.com',
      displayName: 'A',
      schemaName: 'tenant_a_b_com_1234abcd',
      infisicalProjectId: 'inf-1',
    });
    expect(r.created).toBe(true);
    expect(r.tenant.email).toBe('a@b.com');
  });

  it('insertIfAbsent returns created=false on conflict and re-reads', async () => {
    let call = 0;
    const store = new TenantStore({
      pool: fakePool(async () => {
        call++;
        if (call === 1) return { rows: [] }; // conflict
        return { rows: [ROW] }; // re-read
      }),
    });
    const r = await store.insertIfAbsent({
      tenantId: 't-1',
      email: 'a@b.com',
      displayName: 'A',
      schemaName: 'tenant_a_b_com_1234abcd',
      infisicalProjectId: 'inf-1',
    });
    expect(r.created).toBe(false);
    expect(r.tenant.tenantId).toBe('t-1');
    expect(call).toBe(2);
  });

  it('insertIfAbsent throws if conflict + re-read both return empty (race with delete)', async () => {
    const store = new TenantStore({
      pool: fakePool(async () => ({ rows: [] })),
    });
    await expect(
      store.insertIfAbsent({
        tenantId: 't-1',
        email: 'a@b.com',
        displayName: 'A',
        schemaName: 'tenant_a_b_com_1234abcd',
        infisicalProjectId: 'inf-1',
      }),
    ).rejects.toThrow(/concurrent delete/);
  });
});

describe('schemaNameForEmail', () => {
  it('is deterministic — same email twice → same schema', () => {
    expect(schemaNameForEmail('alice@example.com')).toBe(
      schemaNameForEmail('alice@example.com'),
    );
  });

  it('is case-insensitive — Alice and alice → same schema', () => {
    expect(schemaNameForEmail('Alice@example.com')).toBe(
      schemaNameForEmail('alice@example.com'),
    );
  });

  it('returns a Postgres-safe identifier', () => {
    const s = schemaNameForEmail('Wild+chars#$@example.com');
    expect(s).toMatch(/^tenant_[a-z0-9_]+$/);
    expect(s.length).toBeLessThanOrEqual(63);
  });

  it('different emails → different schemas', () => {
    expect(schemaNameForEmail('a@x.com')).not.toBe(schemaNameForEmail('b@x.com'));
  });

  it('always starts with `tenant_`', () => {
    expect(schemaNameForEmail('zzz@yyy.io').startsWith('tenant_')).toBe(true);
  });
});

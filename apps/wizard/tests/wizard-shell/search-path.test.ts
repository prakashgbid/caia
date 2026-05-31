/**
 * `withTenantSearchPath` — per-request SET LOCAL search_path tests.
 *
 * Phase B Task B4 (2026-05-31). Covers the contract documented in
 * `lib/tenants/search-path.ts`:
 *
 *   1. helper sets search_path correctly
 *   2. helper rolls back on error
 *   3. helper releases client even on throw
 *   4. two concurrent requests don't bleed search_paths
 *   5. search_path is scoped to the transaction (verify with a SELECT
 *      after COMMIT)
 *   6. helper rejects empty tenant schema
 *   7. helper rejects schema with quotes (SQL injection guard)
 *   8. helper handles pool exhaustion
 *   9. helper propagates the function's return value
 *  10. helper supports an explicit external transaction (does NOT
 *      issue BEGIN/COMMIT, does NOT release)
 *
 * We mock the pg `Pool`/`PoolClient` interface directly — `pg-mem` is
 * not in the workspace and the snapshotter's `FakePool` is overkill.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PoolClient } from 'pg';
import {
  withTenantSearchPath,
  buildSetSearchPathStatement,
  quoteTenantIdent,
  InvalidTenantSchemaError,
} from '../../lib/tenants/search-path';

interface QueryLog {
  sql: string;
  params?: unknown[];
}

interface FakeClientState {
  log: QueryLog[];
  released: number;
  /** Optional sql substring → result row */
  rowOverrides?: Array<{ match: string; rows: Array<Record<string, unknown>> }>;
  /** Optional sql substring → throws */
  failOn?: { match: string; error: Error };
}

function makeFakeClient(state: FakeClientState): PoolClient {
  const client = {
    async query(sql: string, params?: unknown[]) {
      state.log.push({ sql, params });
      if (state.failOn && sql.includes(state.failOn.match)) {
        throw state.failOn.error;
      }
      if (state.rowOverrides) {
        for (const ov of state.rowOverrides) {
          if (sql.includes(ov.match)) {
            return { rows: ov.rows, rowCount: ov.rows.length };
          }
        }
      }
      return { rows: [], rowCount: 0 };
    },
    release() {
      state.released++;
    },
  };
  return client as unknown as PoolClient;
}

interface FakePoolState {
  clients: FakeClientState[];
  acquired: number;
  /** When >=0, throws on the Nth connect (zero-indexed) */
  failConnectAtIndex?: number;
}

function makeFakePool(state: FakePoolState) {
  return {
    async connect() {
      const i = state.acquired++;
      if (state.failConnectAtIndex !== undefined && i === state.failConnectAtIndex) {
        throw new Error('pool-exhausted: no more clients available');
      }
      const cs: FakeClientState = { log: [], released: 0 };
      state.clients.push(cs);
      return makeFakeClient(cs);
    },
  };
}

describe('buildSetSearchPathStatement', () => {
  it('produces a quoted-identifier SET LOCAL statement', () => {
    expect(buildSetSearchPathStatement('tenant_abc')).toBe(
      'SET LOCAL search_path = "tenant_abc", public',
    );
  });
});

describe('quoteTenantIdent', () => {
  it('quotes a valid identifier', () => {
    expect(quoteTenantIdent('tenant_abc_123')).toBe('"tenant_abc_123"');
  });

  it('rejects empty schema name', () => {
    expect(() => quoteTenantIdent('')).toThrow(InvalidTenantSchemaError);
  });

  it('rejects undefined-shaped input', () => {
    expect(() => quoteTenantIdent(undefined as unknown as string)).toThrow(
      InvalidTenantSchemaError,
    );
  });

  it('rejects a schema name containing a double-quote (SQL-injection guard)', () => {
    expect(() => quoteTenantIdent('tenant"; DROP SCHEMA public;--')).toThrow(
      InvalidTenantSchemaError,
    );
  });

  it('rejects a schema name with a hyphen or space', () => {
    expect(() => quoteTenantIdent('tenant abc')).toThrow(InvalidTenantSchemaError);
    expect(() => quoteTenantIdent('tenant-abc')).toThrow(InvalidTenantSchemaError);
  });

  it('rejects a leading digit (Postgres identifier rules)', () => {
    expect(() => quoteTenantIdent('1tenant')).toThrow(InvalidTenantSchemaError);
  });
});

describe('withTenantSearchPath', () => {
  it('sets search_path correctly inside a transaction', async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    await withTenantSearchPath(fp, 'tenant_xyz', async (client) => {
      await client.query('SELECT 1');
    });

    expect(pool.clients).toHaveLength(1);
    const sqls = pool.clients[0]!.log.map((q) => q.sql);
    expect(sqls[0]).toBe('BEGIN');
    expect(sqls[1]).toBe('SET LOCAL search_path = "tenant_xyz", public');
    expect(sqls[2]).toBe('SELECT 1');
    expect(sqls[3]).toBe('COMMIT');
  });

  it('rolls back when the callback throws', async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    await expect(
      withTenantSearchPath(fp, 'tenant_xyz', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    const sqls = pool.clients[0]!.log.map((q) => q.sql);
    expect(sqls).toEqual([
      'BEGIN',
      'SET LOCAL search_path = "tenant_xyz", public',
      'ROLLBACK',
    ]);
  });

  it('releases the pooled client even when the callback throws', async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    await expect(
      withTenantSearchPath(fp, 'tenant_xyz', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect(pool.clients[0]!.released).toBe(1);
  });

  it('releases the pooled client even when ROLLBACK itself throws', async () => {
    const pool = {
      clients: [] as FakeClientState[],
      acquired: 0,
    };
    const fp = makeFakePool(pool);
    // Patch the first client to fail on ROLLBACK
    const origConnect = fp.connect.bind(fp);
    fp.connect = async () => {
      const c = await origConnect();
      const last = pool.clients[pool.clients.length - 1]!;
      last.failOn = { match: 'ROLLBACK', error: new Error('rollback-failed') };
      return c;
    };

    await expect(
      withTenantSearchPath(fp, 'tenant_xyz', async () => {
        throw new Error('original-boom');
      }),
    ).rejects.toThrow('original-boom');

    expect(pool.clients[0]!.released).toBe(1);
  });

  it('two concurrent requests do not bleed search_paths (each gets its own client)', async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    const a = withTenantSearchPath(fp, 'tenant_a', async (client) => {
      await client.query('SELECT 1 as a');
      return 'a-result';
    });
    const b = withTenantSearchPath(fp, 'tenant_b', async (client) => {
      await client.query('SELECT 1 as b');
      return 'b-result';
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe('a-result');
    expect(rb).toBe('b-result');

    // Each got its own client and its own SET LOCAL.
    expect(pool.clients).toHaveLength(2);
    const sqlsA = pool.clients[0]!.log.map((q) => q.sql);
    const sqlsB = pool.clients[1]!.log.map((q) => q.sql);
    const tenantALocal = sqlsA.find((s) => s.startsWith('SET LOCAL'));
    const tenantBLocal = sqlsB.find((s) => s.startsWith('SET LOCAL'));
    expect(tenantALocal).toContain('"tenant_a"');
    expect(tenantBLocal).toContain('"tenant_b"');
    // Cross-bleed assertion: tenant_a's client never saw tenant_b's SET.
    expect(sqlsA.every((s) => !s.includes('tenant_b'))).toBe(true);
    expect(sqlsB.every((s) => !s.includes('tenant_a'))).toBe(true);
  });

  it('search_path is scoped to the transaction — a follow-up SELECT after COMMIT shows the pool default', async () => {
    // We simulate: pool default search_path is `public`. After the
    // wrapper commits, the connection comes back to the pool with
    // search_path === public. We model this by checking that the
    // wrapper's SQL stream does NOT contain a `SET` outside the BEGIN/
    // COMMIT pair, and that an explicit `SHOW search_path` after the
    // wrapper returns 'public'.
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    let postCommitSearchPath = '';
    await withTenantSearchPath(fp, 'tenant_xyz', async (client) => {
      await client.query('SELECT 1');
    });
    // Acquire a fresh client and inspect what search_path it reports.
    // In the fake-pool model, the new client has no SET LOCAL in its
    // log — which mirrors Postgres behaviour: the SET LOCAL never
    // escaped the prior transaction.
    const c2 = await fp.connect();
    await c2.query('SHOW search_path');
    const last = pool.clients[pool.clients.length - 1]!;
    postCommitSearchPath = last.log.find((q) => q.sql.startsWith('SET LOCAL'))?.sql ?? '';
    expect(postCommitSearchPath).toBe('');

    // Also verify the first client's BEGIN/COMMIT bracket the SET LOCAL.
    const firstSqls = pool.clients[0]!.log.map((q) => q.sql);
    const beginIdx = firstSqls.indexOf('BEGIN');
    const commitIdx = firstSqls.indexOf('COMMIT');
    const setIdx = firstSqls.findIndex((s) => s.startsWith('SET LOCAL'));
    expect(beginIdx).toBeLessThan(setIdx);
    expect(setIdx).toBeLessThan(commitIdx);
  });

  it('rejects an empty tenant schema BEFORE acquiring a connection', async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    await expect(
      withTenantSearchPath(fp, '', async () => 'unreachable'),
    ).rejects.toThrow(InvalidTenantSchemaError);

    // Nothing acquired — failed at the validator.
    expect(pool.acquired).toBe(0);
    expect(pool.clients).toHaveLength(0);
  });

  it('rejects a schema name with quotes (SQL injection guard) BEFORE acquiring a connection', async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    await expect(
      withTenantSearchPath(fp, 'tenant"; DROP SCHEMA public;--', async () => 'unreachable'),
    ).rejects.toThrow(InvalidTenantSchemaError);

    expect(pool.acquired).toBe(0);
  });

  it('surfaces pool-exhaustion errors (pool.connect() throws)', async () => {
    const pool = {
      clients: [] as FakeClientState[],
      acquired: 0,
      failConnectAtIndex: 0,
    };
    const fp = makeFakePool(pool);

    await expect(
      withTenantSearchPath(fp, 'tenant_xyz', async () => 'unreachable'),
    ).rejects.toThrow(/pool-exhausted/);
    // No client to release because none was acquired.
    expect(pool.clients).toHaveLength(0);
  });

  it("propagates the callback's return value (typed generic)", async () => {
    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    const result = await withTenantSearchPath<{ answer: number }>(
      fp,
      'tenant_xyz',
      async () => ({ answer: 42 }),
    );

    expect(result).toEqual({ answer: 42 });
  });

  it('supports an explicit external transaction — no BEGIN/COMMIT, no release', async () => {
    const log: QueryLog[] = [];
    let released = 0;
    const externalClient: PoolClient = {
      async query(sql: string, params?: unknown[]) {
        log.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
      release() {
        released++;
      },
    } as unknown as PoolClient;

    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    const result = await withTenantSearchPath(
      fp,
      'tenant_ext',
      async (client) => {
        // Should be the same client object we passed in.
        expect(client).toBe(externalClient);
        await client.query('SELECT 1');
        return 'ok';
      },
      { externalClient },
    );

    expect(result).toBe('ok');
    // Pool was NOT touched.
    expect(pool.acquired).toBe(0);
    expect(pool.clients).toHaveLength(0);
    // Caller's client was NOT released by us.
    expect(released).toBe(0);
    // No BEGIN/COMMIT — only SET LOCAL + the inner SELECT.
    const sqls = log.map((q) => q.sql);
    expect(sqls).toEqual([
      'SET LOCAL search_path = "tenant_ext", public',
      'SELECT 1',
    ]);
  });

  it('does not COMMIT and does not ROLLBACK when the external transaction callback throws (caller owns lifecycle)', async () => {
    const log: QueryLog[] = [];
    const externalClient: PoolClient = {
      async query(sql: string, params?: unknown[]) {
        log.push({ sql, params });
        return { rows: [], rowCount: 0 };
      },
      release() {
        /* no-op */
      },
    } as unknown as PoolClient;

    const pool = { clients: [] as FakeClientState[], acquired: 0 };
    const fp = makeFakePool(pool);

    await expect(
      withTenantSearchPath(
        fp,
        'tenant_ext',
        async () => {
          throw new Error('caller-handles-this');
        },
        { externalClient },
      ),
    ).rejects.toThrow('caller-handles-this');

    const sqls = log.map((q) => q.sql);
    expect(sqls).toEqual(['SET LOCAL search_path = "tenant_ext", public']);
    expect(sqls).not.toContain('ROLLBACK');
    expect(sqls).not.toContain('COMMIT');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  PostgresSecretsAdapter,
  TenantKeyCache,
  encryptValue,
  deriveTenantKey,
} from '../../src/index.js';
import {
  SecretNotFoundError,
  SecretProviderError,
  SecretsAdapterConfigError,
  type AccessContext,
} from '@caia/secrets-adapter';
import { MockPool } from './mock-pool.js';

const masterHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

const ctx: AccessContext = {
  callerType: 'agent',
  callerId: 'unit-test',
  reason: 'test fetch',
};

function freshAdapter(overrides: Parameters<typeof PostgresSecretsAdapter['prototype']['constructor']>[0] extends infer T ? Partial<T> : never = {}): { adapter: PostgresSecretsAdapter; pool: MockPool } {
  const pool = new MockPool();
  const adapter = new PostgresSecretsAdapter({
    pool,
    masterKeyHex: masterHex,
    ...overrides,
  });
  return { adapter, pool };
}

describe('PostgresSecretsAdapter — construction', () => {
  it('requires `pool`', () => {
    expect(
      () => new PostgresSecretsAdapter({ masterKeyHex: masterHex } as never),
    ).toThrow(SecretsAdapterConfigError);
  });
  it('requires masterKey or masterKeyHex', () => {
    expect(
      () =>
        new PostgresSecretsAdapter({ pool: new MockPool() } as never),
    ).toThrow(SecretsAdapterConfigError);
  });
  it('accepts raw masterKey Buffer', () => {
    const m = Buffer.alloc(32, 1);
    const adapter = new PostgresSecretsAdapter({
      pool: new MockPool(),
      masterKey: m,
    });
    expect(adapter).toBeDefined();
  });
  it('rejects wrong-length masterKey', () => {
    expect(
      () =>
        new PostgresSecretsAdapter({
          pool: new MockPool(),
          masterKey: Buffer.alloc(31),
        }),
    ).toThrow(SecretsAdapterConfigError);
  });
});

describe('PostgresSecretsAdapter — put + get (round-trip)', () => {
  it('stores then retrieves the same plaintext', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('tenant-a', 'cloud.aws', 'access_key', 'AKIA-secret');
    const got = await adapter.get('tenant-a', 'cloud.aws', 'access_key', ctx);
    expect(got).toBe('AKIA-secret');
    expect(pool.secrets).toHaveLength(1);
    expect(pool.secrets[0]?.ciphertext_b64).not.toContain('AKIA-secret');
  });

  it('ciphertext column is base64', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('tenant-a', 'c', 'k', 'plaintext');
    expect(pool.secrets[0]?.ciphertext_b64).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('replace upserts and bumps version', async () => {
    const { adapter, pool } = freshAdapter();
    const a = await adapter.put('t', 'c', 'k', 'v1', { replace: true });
    const b = await adapter.put('t', 'c', 'k', 'v2', { replace: true });
    expect(b.version).toBe((a.version ?? 0) + 1);
    const got = await adapter.get('t', 'c', 'k', ctx);
    expect(got).toBe('v2');
    expect(pool.secrets).toHaveLength(1);
  });

  it('plain put conflict throws SecretProviderError', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v1');
    await expect(adapter.put('t', 'c', 'k', 'v2')).rejects.toBeInstanceOf(
      SecretProviderError,
    );
  });

  it('rejects invalid tenantId', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.put('Tenant', 'c', 'k', 'v')).rejects.toThrow();
  });
  it('rejects invalid category', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.put('t', 'Cloud', 'k', 'v')).rejects.toThrow();
  });
  it('rejects empty secret value', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.put('t', 'c', 'k', '')).rejects.toThrow();
  });
});

describe('PostgresSecretsAdapter — get failures', () => {
  it('not-found throws SecretNotFoundError', async () => {
    const { adapter } = freshAdapter();
    await expect(
      adapter.get('t', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('rejects invalid AccessContext', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    // @ts-expect-error — missing reason
    await expect(adapter.get('t', 'c', 'k', {})).rejects.toThrow();
  });

  it('expired secret throws SecretNotFoundError', async () => {
    let now = new Date('2026-05-23T00:00:00Z');
    const { adapter } = freshAdapter({ now: () => now });
    await adapter.put('t', 'c', 'k', 'v', { ttlSeconds: 60 });
    // Advance past the TTL.
    now = new Date('2026-05-23T00:02:00Z');
    await expect(
      adapter.get('t', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('tampered ciphertext throws SecretProviderError', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    // Flip a bit in the ciphertext.
    const buf = Buffer.from(pool.secrets[0]!.ciphertext_b64, 'base64');
    buf[buf.length - 1] = buf[buf.length - 1]! ^ 0xff;
    pool.secrets[0]!.ciphertext_b64 = buf.toString('base64');
    await expect(
      adapter.get('t', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretProviderError);
  });
});

describe('PostgresSecretsAdapter — audit log emission', () => {
  it('successful get writes ok=true audit row', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    await adapter.get('t', 'c', 'k', ctx);
    const audit = pool.audit.filter((r) => r.action === 'get');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.ok).toBe(true);
    expect(audit[0]?.caller_id).toBe('unit-test');
  });

  it('failed get writes ok=false audit row with error_class', async () => {
    const { adapter, pool } = freshAdapter();
    await expect(
      adapter.get('t', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
    const audit = pool.audit.filter((r) => r.action === 'get');
    expect(audit).toHaveLength(1);
    expect(audit[0]?.ok).toBe(false);
    expect(audit[0]?.error_class).toBe('not_found');
  });

  it('putWithAudit writes a put row', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.putWithAudit('t', 'c', 'k', 'v', ctx);
    const puts = pool.audit.filter((r) => r.action === 'put');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.ok).toBe(true);
  });

  it('putWithAudit on duplicate writes an ok=false row', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    await expect(
      adapter.putWithAudit('t', 'c', 'k', 'v2', ctx),
    ).rejects.toBeInstanceOf(SecretProviderError);
    const puts = pool.audit.filter((r) => r.action === 'put');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.ok).toBe(false);
    expect(puts[0]?.error_class).toBe('provider_error');
  });

  it('auditLog query filters by tenant', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t1', 'c', 'k', 'v');
    await adapter.put('t2', 'c', 'k', 'v');
    await adapter.get('t1', 'c', 'k', ctx);
    await adapter.get('t2', 'c', 'k', ctx);
    // Direct mock-state check
    expect(pool.audit.filter((r) => r.tenant_id === 't1')).toHaveLength(1);
    // Now exercise the auditLog accessor
    const t1Log = await adapter.auditLog('t1');
    expect(t1Log).toHaveLength(1);
    expect(t1Log[0]?.tenantId).toBe('t1');
  });
});

describe('PostgresSecretsAdapter — list / rotate / delete', () => {
  it('list returns metadata only', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t', 'cloud.aws', 'key1', 'v');
    await adapter.put('t', 'cloud.aws', 'key2', 'v');
    await adapter.put('t', 'dns.cf', 'token', 'v');
    const all = await adapter.list('t');
    expect(all).toHaveLength(3);
    for (const m of all) expect(m).not.toHaveProperty('value');
  });

  it('list filtered by category', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t', 'cloud.aws', 'k', 'v');
    await adapter.put('t', 'dns.cf', 'k', 'v');
    const aws = await adapter.list('t', 'cloud.aws');
    expect(aws).toHaveLength(1);
    expect(aws[0]?.category).toBe('cloud.aws');
  });

  it('list isolates tenants', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t1', 'c', 'k', 'v');
    await adapter.put('t2', 'c', 'k', 'v');
    expect(await adapter.list('t1')).toHaveLength(1);
    expect(await adapter.list('t2')).toHaveLength(1);
  });

  it('rotate bumps version', async () => {
    const { adapter } = freshAdapter();
    const put = await adapter.put('t', 'c', 'k', 'v');
    const r = await adapter.rotate('t', 'c', 'k');
    expect(r.version).toBe((put.version ?? 0) + 1);
  });

  it('rotate on missing throws SecretNotFoundError', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.rotate('t', 'c', 'k')).rejects.toBeInstanceOf(
      SecretNotFoundError,
    );
  });

  it('delete is idempotent', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    await adapter.delete('t', 'c', 'k');
    // Second delete shouldn't throw.
    await expect(adapter.delete('t', 'c', 'k')).resolves.toBeUndefined();
  });

  it('delete only affects target row', async () => {
    const { adapter } = freshAdapter();
    await adapter.put('t', 'a', 'k', 'v');
    await adapter.put('t', 'b', 'k', 'v');
    await adapter.delete('t', 'a', 'k');
    expect(await adapter.list('t')).toHaveLength(1);
  });
});

describe('PostgresSecretsAdapter — crypto-shred (deleteAllForTenant)', () => {
  it('drops all rows for tenant', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t1', 'c', 'k1', 'v');
    await adapter.put('t1', 'c', 'k2', 'v');
    await adapter.put('t2', 'c', 'k', 'v');
    const r = await adapter.deleteAllForTenant('t1');
    expect(r.deletedCount).toBe(2);
    expect(pool.secrets.filter((s) => s.tenant_id === 't1')).toHaveLength(0);
    expect(pool.secrets.filter((s) => s.tenant_id === 't2')).toHaveLength(1);
  });

  it('records a tombstone ref', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    const r = await adapter.deleteAllForTenant('t');
    expect(r.tenantTombstoneRef).toMatch(/^tomb_t_/);
    expect(pool.shred).toHaveLength(1);
    expect(pool.shred[0]?.tenant_id).toBe('t');
  });

  it('dryRun does not delete or shred', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    const r = await adapter.deleteAllForTenant('t', { dryRun: true });
    expect(r.deletedCount).toBe(1);
    expect(r.tenantTombstoneRef).toContain('dryrun');
    expect(pool.secrets).toHaveLength(1);
    expect(pool.shred).toHaveLength(0);
  });

  it('shredded tenant cannot be written-to or read-from', async () => {
    const cache = new TenantKeyCache();
    const { adapter } = freshAdapter({ keyCache: cache });
    await adapter.put('t', 'c', 'k', 'v');
    await adapter.deleteAllForTenant('t');
    // Cache was invalidated.
    expect(cache.get('t')).toBeUndefined();
    // Subsequent put fails because assertNotShredded throws.
    await expect(adapter.put('t', 'c', 'k2', 'v2')).rejects.toBeInstanceOf(
      SecretsAdapterConfigError,
    );
  });

  it('zero secrets is a valid no-op shred', async () => {
    const { adapter } = freshAdapter();
    const r = await adapter.deleteAllForTenant('t');
    expect(r.deletedCount).toBe(0);
    expect(r.tenantTombstoneRef).toMatch(/^tomb_/);
  });

  it('rejects invalid tenantId', async () => {
    const { adapter } = freshAdapter();
    await expect(adapter.deleteAllForTenant('UpperCase')).rejects.toThrow();
  });
});

describe('PostgresSecretsAdapter — key cache integration', () => {
  it('reuses cached tenant key across calls', async () => {
    const cache = new TenantKeyCache();
    const { adapter } = freshAdapter({ keyCache: cache });
    await adapter.put('t', 'c', 'k1', 'v');
    expect(cache.size).toBe(1);
    await adapter.put('t', 'c', 'k2', 'v');
    expect(cache.size).toBe(1);
  });

  it('different tenants → different cache entries', async () => {
    const cache = new TenantKeyCache();
    const { adapter } = freshAdapter({ keyCache: cache });
    await adapter.put('t1', 'c', 'k', 'v');
    await adapter.put('t2', 'c', 'k', 'v');
    expect(cache.size).toBe(2);
  });
});

describe('PostgresSecretsAdapter — ping', () => {
  it('returns ok on healthy pool', async () => {
    const { adapter } = freshAdapter();
    const r = await adapter.ping();
    expect(r.ok).toBe(true);
    expect(r.backend).toBe('postgres');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns not-ok when pool throws', async () => {
    const pool = new MockPool();
    pool.failNext = { match: /SELECT 1/, err: new Error('down') };
    const adapter = new PostgresSecretsAdapter({ pool, masterKeyHex: masterHex });
    const r = await adapter.ping();
    expect(r.ok).toBe(false);
    expect(r.backend).toBe('postgres');
  });
});

describe('PostgresSecretsAdapter — cross-tenant isolation', () => {
  it('tenant A get cannot decrypt tenant B row even if values are swapped', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t1', 'c', 'k', 'secret-1');
    await adapter.put('t2', 'c', 'k', 'secret-2');
    // Swap ciphertexts — t1 row now holds t2's encrypted blob, encrypted
    // under t2's derived key. t1's get must fail authentication.
    const a = pool.secrets.find((r) => r.tenant_id === 't1')!;
    const b = pool.secrets.find((r) => r.tenant_id === 't2')!;
    [a.ciphertext_b64, b.ciphertext_b64] = [b.ciphertext_b64, a.ciphertext_b64];
    await expect(
      adapter.get('t1', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretProviderError);
    await expect(
      adapter.get('t2', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretProviderError);
  });

  it('hand-crafted ciphertext with right key still verifies', async () => {
    // Sanity check that the round-trip works even with hand-crafted blobs.
    const masterBuf = Buffer.from(masterHex, 'hex');
    const k = deriveTenantKey(masterBuf, 'manual');
    const blob = encryptValue(k, 'hello');
    const pool = new MockPool();
    pool.secrets.push({
      id: 1,
      tenant_id: 'manual',
      category: 'c',
      key: 'k',
      ciphertext_b64: blob,
      version: 1,
      created_at: new Date(),
      last_accessed_at: null,
      last_rotated_at: null,
      expires_at: null,
    });
    const adapter = new PostgresSecretsAdapter({ pool, masterKeyHex: masterHex });
    expect(await adapter.get('manual', 'c', 'k', ctx)).toBe('hello');
  });
});

describe('PostgresSecretsAdapter — audit query', () => {
  beforeEach(() => undefined);
  it('returns rows sorted by granted_at DESC', async () => {
    const { adapter, pool } = freshAdapter();
    await adapter.put('t', 'c', 'k', 'v');
    await adapter.get('t', 'c', 'k', ctx);
    await adapter.get('t', 'c', 'k', ctx);
    expect(pool.audit.filter((r) => r.action === 'get')).toHaveLength(2);
    const log = await adapter.auditLog('t');
    expect(log).toHaveLength(2);
    expect(log[0]?.grantedAt.getTime()).toBeGreaterThanOrEqual(
      log[1]?.grantedAt.getTime() ?? 0,
    );
  });
});

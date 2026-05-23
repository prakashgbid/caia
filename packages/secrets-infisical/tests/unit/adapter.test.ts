import { describe, it, expect } from 'vitest';
import {
  InfisicalSecretsAdapter,
  ConfigMapProjectResolver,
  InMemoryAuditLogger,
} from '../../src/index.js';
import {
  SecretNotFoundError,
  SecretPolicyDeniedError,
  SecretsAdapterConfigError,
  type AccessContext,
} from '@caia/secrets-adapter';
import { MockInfisicalServer } from './fetch-mock.js';

const ctx: AccessContext = {
  callerType: 'agent',
  callerId: 'unit-test',
  reason: 'integration round-trip',
};

function newAdapter(server: MockInfisicalServer, audit?: InMemoryAuditLogger): InfisicalSecretsAdapter {
  return new InfisicalSecretsAdapter({
    baseUrl: 'https://infisical.test',
    auth: { type: 'static-token', accessToken: 'tok_1' },
    projectResolver: new ConfigMapProjectResolver({
      'tenant-a': 'wsk-a',
      'tenant-b': 'wsk-b',
    }),
    environment: 'prod',
    fetchImpl: server.fetchImpl,
    ...(audit ? { auditLogger: audit } : {}),
  });
}

describe('InfisicalSecretsAdapter — construction', () => {
  it('requires baseUrl', () => {
    expect(
      () =>
        new InfisicalSecretsAdapter({
          baseUrl: '',
          auth: { type: 'static-token', accessToken: 't' },
          projectResolver: new ConfigMapProjectResolver({}),
        } as never),
    ).toThrow(SecretsAdapterConfigError);
  });
  it('requires projectResolver', () => {
    expect(
      () =>
        new InfisicalSecretsAdapter({
          baseUrl: 'https://x',
          auth: { type: 'static-token', accessToken: 't' },
        } as never),
    ).toThrow(SecretsAdapterConfigError);
  });
});

describe('InfisicalSecretsAdapter — put + get round-trip', () => {
  it('round-trips a secret', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'cloud.aws', 'access_key', 'AKIA-secret');
    const got = await adapter.get(
      'tenant-a',
      'cloud.aws',
      'access_key',
      ctx,
    );
    expect(got).toBe('AKIA-secret');
  });

  it('put returns secretRef + version', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    const r = await adapter.put('tenant-a', 'c', 'k', 'v');
    expect(r.secretRef).toMatch(/^inf_/);
    expect(r.version).toBe(1);
  });

  it('replace=true updates an existing secret', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v1');
    await adapter.put('tenant-a', 'c', 'k', 'v2', { replace: true });
    expect(await adapter.get('tenant-a', 'c', 'k', ctx)).toBe('v2');
  });

  it('replace=true creates if absent', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    const r = await adapter.put('tenant-a', 'c', 'k', 'v', { replace: true });
    expect(r.version).toBe(1);
  });

  it('rejects invalid tenantId', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await expect(
      adapter.put('Tenant', 'c', 'k', 'v'),
    ).rejects.toThrow();
  });

  it('rejects invalid category', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await expect(
      adapter.put('tenant-a', 'Cloud', 'k', 'v'),
    ).rejects.toThrow();
  });

  it('rejects empty value', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await expect(adapter.put('tenant-a', 'c', 'k', '')).rejects.toThrow();
  });
});

describe('InfisicalSecretsAdapter — get failures', () => {
  it('missing -> SecretNotFoundError', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await expect(
      adapter.get('tenant-a', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('unknown tenant -> SecretPolicyDeniedError', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await expect(
      adapter.get('tenant-unknown', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretPolicyDeniedError);
  });

  it('rejects malformed AccessContext', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    // @ts-expect-error — missing reason
    await expect(adapter.get('tenant-a', 'c', 'k', {})).rejects.toThrow();
  });
});

describe('InfisicalSecretsAdapter — audit log emission', () => {
  it('successful get emits an ok=true audit row', async () => {
    const server = new MockInfisicalServer();
    const audit = new InMemoryAuditLogger();
    const adapter = newAdapter(server, audit);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    await adapter.get('tenant-a', 'c', 'k', ctx);
    const gets = audit.events.filter((e) => e.action === 'get');
    expect(gets).toHaveLength(1);
    expect(gets[0]?.ok).toBe(true);
    expect(gets[0]?.callerContext.callerId).toBe('unit-test');
  });

  it('failed get emits ok=false with errorClass', async () => {
    const server = new MockInfisicalServer();
    const audit = new InMemoryAuditLogger();
    const adapter = newAdapter(server, audit);
    await expect(
      adapter.get('tenant-a', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
    const gets = audit.events.filter((e) => e.action === 'get');
    expect(gets).toHaveLength(1);
    expect(gets[0]?.ok).toBe(false);
    expect(gets[0]?.errorClass).toBe('not_found');
  });

  it('putWithAudit emits put rows', async () => {
    const server = new MockInfisicalServer();
    const audit = new InMemoryAuditLogger();
    const adapter = newAdapter(server, audit);
    await adapter.putWithAudit('tenant-a', 'c', 'k', 'v', ctx);
    const puts = audit.events.filter((e) => e.action === 'put');
    expect(puts).toHaveLength(1);
    expect(puts[0]?.ok).toBe(true);
  });

  it('adapter.auditLog returns its local events', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    await adapter.get('tenant-a', 'c', 'k', ctx);
    await adapter.get('tenant-a', 'c', 'k', ctx);
    const log = await adapter.auditLog('tenant-a');
    expect(log).toHaveLength(2);
    for (const entry of log) expect(entry.tenantId).toBe('tenant-a');
  });

  it('audit log isolates tenants', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'va');
    await adapter.put('tenant-b', 'c', 'k', 'vb');
    await adapter.get('tenant-a', 'c', 'k', ctx);
    await adapter.get('tenant-b', 'c', 'k', ctx);
    const a = await adapter.auditLog('tenant-a');
    const b = await adapter.auditLog('tenant-b');
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });
});

describe('InfisicalSecretsAdapter — list / rotate / delete', () => {
  it('list returns metadata only', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'cloud.aws', 'k1', 'v');
    await adapter.put('tenant-a', 'cloud.aws', 'k2', 'v');
    const list = await adapter.list('tenant-a', 'cloud.aws');
    expect(list).toHaveLength(2);
    for (const m of list) expect(m).not.toHaveProperty('secretValue');
  });

  it('rotate bumps version', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    const r = await adapter.rotate('tenant-a', 'c', 'k');
    expect(r.version).toBe(2);
  });

  it('delete + get yields SecretNotFoundError', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    await adapter.delete('tenant-a', 'c', 'k');
    await expect(
      adapter.get('tenant-a', 'c', 'k', ctx),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('delete is idempotent', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.delete('tenant-a', 'c', 'k');
    await expect(
      adapter.delete('tenant-a', 'c', 'k'),
    ).resolves.toBeUndefined();
  });
});

describe('InfisicalSecretsAdapter — deleteAllForTenant', () => {
  it('drops all secrets for the tenant', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c1', 'k', 'v');
    await adapter.put('tenant-a', 'c2', 'k', 'v');
    await adapter.put('tenant-b', 'c', 'k', 'v');
    const r = await adapter.deleteAllForTenant('tenant-a');
    expect(r.deletedCount).toBe(2);
    expect(r.tenantTombstoneRef).toMatch(/^tomb_tenant-a_/);
    expect(server.secrets.filter((s) => s.workspaceId === 'wsk-a')).toHaveLength(0);
    expect(server.secrets.filter((s) => s.workspaceId === 'wsk-b')).toHaveLength(1);
  });

  it('dryRun does not delete', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    const r = await adapter.deleteAllForTenant('tenant-a', { dryRun: true });
    expect(r.deletedCount).toBe(1);
    expect(r.tenantTombstoneRef).toContain('dryrun');
    expect(server.secrets).toHaveLength(1);
  });

  it('rejects invalid tenantId', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await expect(adapter.deleteAllForTenant('UpperCase')).rejects.toThrow();
  });

  it('zero secrets is a valid no-op', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    const r = await adapter.deleteAllForTenant('tenant-a');
    expect(r.deletedCount).toBe(0);
  });
});

describe('InfisicalSecretsAdapter — tenant isolation', () => {
  it('tenant A cannot read tenant B secrets', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'shared-key', 'secret-A');
    await adapter.put('tenant-b', 'c', 'shared-key', 'secret-B');
    expect(await adapter.get('tenant-a', 'c', 'shared-key', ctx)).toBe(
      'secret-A',
    );
    expect(await adapter.get('tenant-b', 'c', 'shared-key', ctx)).toBe(
      'secret-B',
    );
  });

  it('list per-tenant only returns the tenant rows', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    await adapter.put('tenant-a', 'c', 'k', 'v');
    await adapter.put('tenant-b', 'c', 'k', 'v');
    const aList = await adapter.list('tenant-a', 'c');
    const bList = await adapter.list('tenant-b', 'c');
    expect(aList).toHaveLength(1);
    expect(bList).toHaveLength(1);
  });
});

describe('InfisicalSecretsAdapter — ping', () => {
  it('returns ok=true backend=infisical when healthy', async () => {
    const server = new MockInfisicalServer();
    const adapter = newAdapter(server);
    const r = await adapter.ping();
    expect(r.ok).toBe(true);
    expect(r.backend).toBe('infisical');
  });
});

describe('InfisicalSecretsAdapter — Cloudflare Access', () => {
  it('passes CF headers through every request', async () => {
    const server = new MockInfisicalServer();
    server.requireCfHeaders = true;
    const adapter = new InfisicalSecretsAdapter({
      baseUrl: 'https://infisical.chiefaia.com',
      auth: { type: 'static-token', accessToken: 't' },
      cloudflareAccess: { clientId: 'cf-id', clientSecret: 'cf-sec' },
      projectResolver: new ConfigMapProjectResolver({ 'tenant-a': 'wsk-a' }),
      fetchImpl: server.fetchImpl,
    });
    await adapter.put('tenant-a', 'c', 'k', 'v');
    const putCall = server.calls.find((c) => c.method === 'POST');
    expect(putCall?.headers['CF-Access-Client-Id']).toBe('cf-id');
    expect(putCall?.headers['CF-Access-Client-Secret']).toBe('cf-sec');
  });
});

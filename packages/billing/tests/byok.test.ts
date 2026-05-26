/**
 * BYOK tests — set/get/revoke, validation, per-tenant isolation, audit.
 */

import { describe, expect, it } from 'vitest';

import {
  EVENT_TENANT_RUNTIME_KEY_READ,
  EVENT_TENANT_RUNTIME_KEY_REVOKED,
  EVENT_TENANT_RUNTIME_KEY_SET,
  InvalidKeyError,
  RuntimeKeyNotSetError,
  RUNTIME_KEY_CATEGORY,
  runtimeKeyName,
  ShapeOnlyKeyValidator,
} from '../src/index.js';
import {
  FakeSecretsAdapter,
  PROVIDER_KEYS,
  makeAccessContext,
  makeByok,
} from './_fixtures.js';

describe('ShapeOnlyKeyValidator', () => {
  it('rejects empty + too-short keys', async () => {
    const v = new ShapeOnlyKeyValidator();
    await expect(v.validate('anthropic', '')).rejects.toBeInstanceOf(InvalidKeyError);
    await expect(v.validate('anthropic', 'short')).rejects.toBeInstanceOf(InvalidKeyError);
  });

  it('rejects keys with wrong provider prefix', async () => {
    const v = new ShapeOnlyKeyValidator();
    await expect(v.validate('anthropic', 'sk-openai-1234567890abcdefghij')).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    await expect(v.validate('openai', 'sk-ant-1234567890abcdefghij')).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
  });

  it('accepts well-formed provider keys', async () => {
    const v = new ShapeOnlyKeyValidator();
    await expect(v.validate('anthropic', PROVIDER_KEYS.anthropic)).resolves.toBeUndefined();
    await expect(v.validate('openai', PROVIDER_KEYS.openai)).resolves.toBeUndefined();
    await expect(v.validate('google', PROVIDER_KEYS.google)).resolves.toBeUndefined();
  });

  it('accepts keys for providers without a known prefix', async () => {
    const v = new ShapeOnlyKeyValidator();
    await expect(v.validate('mistral', PROVIDER_KEYS.mistral)).resolves.toBeUndefined();
    await expect(v.validate('azure', PROVIDER_KEYS.azure)).resolves.toBeUndefined();
  });
});

describe('ByokService.setRuntimeKey', () => {
  it('persists to the adapter and emits runtime.key.set', async () => {
    const { byok, adapter, bus } = makeByok();
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_RUNTIME_KEY_SET, (p) => seen.push(p));

    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      tenantId: 't1',
      provider: 'anthropic',
      rotated: false,
    });
    expect(
      await adapter.get('t1', RUNTIME_KEY_CATEGORY, runtimeKeyName('anthropic'), makeAccessContext()),
    ).toBe(PROVIDER_KEYS.anthropic);
  });

  it('emits rotated:true when overwriting an existing key', async () => {
    const { byok, bus } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);

    const seen: Array<{ rotated: boolean }> = [];
    bus.on(EVENT_TENANT_RUNTIME_KEY_SET, (p) => seen.push(p as { rotated: boolean }));

    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic + 'new');
    expect(seen.at(-1)?.rotated).toBe(true);
  });

  it('rejects invalid keys before touching the vault', async () => {
    const { byok, adapter } = makeByok();
    await expect(byok.setRuntimeKey('t1', 'anthropic', 'bad')).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
    const list = await adapter.list('t1', RUNTIME_KEY_CATEGORY);
    expect(list).toHaveLength(0);
  });

  it('rejects unknown providers via Zod', async () => {
    const { byok } = makeByok();
    // @ts-expect-error -- intentionally wrong
    await expect(byok.setRuntimeKey('t1', 'no-such', 'sk-test-' + 'x'.repeat(30))).rejects.toThrow();
  });
});

describe('ByokService.getRuntimeKey', () => {
  it('returns the key and writes one audit row marked ok', async () => {
    const { byok, auditStore } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);

    const key = await byok.getRuntimeKey('t1', 'anthropic', makeAccessContext());
    expect(key).toBe(PROVIDER_KEYS.anthropic);

    const rows = await auditStore.list('t1', { provider: 'anthropic' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: 't1',
      provider: 'anthropic',
      ok: true,
    });
    expect(rows[0]?.errorClass).toBeUndefined();
  });

  it('writes audit row marked ok:false when key not set, then throws RuntimeKeyNotSetError', async () => {
    const { byok, auditStore } = makeByok();
    await expect(
      byok.getRuntimeKey('t1', 'openai', makeAccessContext()),
    ).rejects.toBeInstanceOf(RuntimeKeyNotSetError);

    const rows = await auditStore.list('t1', { provider: 'openai' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ok: false,
      errorClass: 'not_found',
    });
  });

  it('audits a non-not_found provider error and rethrows it', async () => {
    const adapter = new FakeSecretsAdapter();
    const { byok, auditStore } = makeByok(adapter);
    // Patch the adapter to throw a non-not_found error.
    adapter.get = async () => {
      throw new Error('upstream 503');
    };
    await expect(
      byok.getRuntimeKey('t1', 'anthropic', makeAccessContext()),
    ).rejects.toThrow('upstream 503');
    const rows = await auditStore.list('t1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ok: false, errorClass: 'provider_error' });
  });

  it('passes the AccessContext through to the adapter (audit envelope intact)', async () => {
    const { byok, adapter } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);
    await byok.getRuntimeKey(
      't1',
      'anthropic',
      makeAccessContext({ callerType: 'agent', callerId: 'orchestrator', reason: 'deploy' }),
    );
    expect(adapter.getCalls.at(-1)?.callerContext).toMatchObject({
      callerType: 'agent',
      callerId: 'orchestrator',
      reason: 'deploy',
    });
  });

  it('emits tenant.runtime.key.read for each read, with status', async () => {
    const { byok, bus } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);
    const seen: Array<{ ok: boolean }> = [];
    bus.on(EVENT_TENANT_RUNTIME_KEY_READ, (p) => seen.push(p as { ok: boolean }));

    await byok.getRuntimeKey('t1', 'anthropic', makeAccessContext());
    expect(seen.at(-1)?.ok).toBe(true);
  });
});

describe('per-tenant isolation', () => {
  it('tenant A cannot read tenant B\'s key', async () => {
    const { byok } = makeByok();
    await byok.setRuntimeKey('tenant-a', 'anthropic', PROVIDER_KEYS.anthropic);
    await expect(
      byok.getRuntimeKey('tenant-b', 'anthropic', makeAccessContext()),
    ).rejects.toBeInstanceOf(RuntimeKeyNotSetError);
  });

  it('tenant A and tenant B can hold different anthropic keys', async () => {
    const { byok } = makeByok();
    const keyA = PROVIDER_KEYS.anthropic;
    const keyB = PROVIDER_KEYS.anthropic + 'B';
    await byok.setRuntimeKey('tenant-a', 'anthropic', keyA);
    await byok.setRuntimeKey('tenant-b', 'anthropic', keyB);
    expect(await byok.getRuntimeKey('tenant-a', 'anthropic', makeAccessContext())).toBe(keyA);
    expect(await byok.getRuntimeKey('tenant-b', 'anthropic', makeAccessContext())).toBe(keyB);
  });

  it('listConfiguredProviders only returns the calling tenant\'s providers', async () => {
    const { byok } = makeByok();
    await byok.setRuntimeKey('tenant-a', 'anthropic', PROVIDER_KEYS.anthropic);
    await byok.setRuntimeKey('tenant-a', 'openai', PROVIDER_KEYS.openai);
    await byok.setRuntimeKey('tenant-b', 'google', PROVIDER_KEYS.google);

    const aProviders = await byok.listConfiguredProviders('tenant-a');
    expect(aProviders.sort()).toEqual(['anthropic', 'openai']);
    expect(await byok.listConfiguredProviders('tenant-b')).toEqual(['google']);
  });

  it('audit rows for tenant A do not leak into tenant B listings', async () => {
    const { byok, auditStore } = makeByok();
    await byok.setRuntimeKey('tenant-a', 'anthropic', PROVIDER_KEYS.anthropic);
    await byok.getRuntimeKey('tenant-a', 'anthropic', makeAccessContext());
    expect(await auditStore.list('tenant-b')).toHaveLength(0);
    expect((await auditStore.list('tenant-a')).length).toBeGreaterThan(0);
  });
});

describe('ByokService.revokeRuntimeKey', () => {
  it('deletes from the vault and emits runtime.key.revoked', async () => {
    const { byok, adapter, bus } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_RUNTIME_KEY_REVOKED, (p) => seen.push(p));

    await byok.revokeRuntimeKey('t1', 'anthropic');
    expect((await adapter.list('t1', RUNTIME_KEY_CATEGORY)).length).toBe(0);
    expect(seen).toHaveLength(1);
  });

  it('is idempotent — revoking an absent key still emits the event', async () => {
    const { byok, bus } = makeByok();
    const seen: unknown[] = [];
    bus.on(EVENT_TENANT_RUNTIME_KEY_REVOKED, (p) => seen.push(p));

    await byok.revokeRuntimeKey('t-empty', 'anthropic');
    expect(seen).toHaveLength(1);
  });
});

describe('audit log shape', () => {
  it('includes ticketId when provided in the access context', async () => {
    const { byok, auditStore } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);
    await byok.getRuntimeKey(
      't1',
      'anthropic',
      makeAccessContext({ ticketId: 'TKT-42', callerType: 'deploy-worker', callerId: 'worker-1' }),
    );
    const rows = await auditStore.list('t1');
    expect(rows[0]?.ticketId).toBe('TKT-42');
  });

  it('returns rows sorted newest-first', async () => {
    const { byok, auditStore } = makeByok();
    await byok.setRuntimeKey('t1', 'anthropic', PROVIDER_KEYS.anthropic);
    await byok.getRuntimeKey('t1', 'anthropic', makeAccessContext());
    await new Promise((r) => setTimeout(r, 5));
    await byok.getRuntimeKey('t1', 'anthropic', makeAccessContext());
    const rows = await auditStore.list('t1');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.readAt.getTime()).toBeGreaterThanOrEqual(rows[1]!.readAt.getTime());
  });
});

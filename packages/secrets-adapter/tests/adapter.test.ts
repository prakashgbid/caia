import { describe, it, expect } from 'vitest';
import type { SecretsAdapter } from '../src/adapter.js';
import type { AccessContext, AccessLogEntry, SecretMetadata } from '../src/types.js';

/**
 * In-memory witness adapter — proves the interface is implementable
 * and exercises the contract surface. Full coverage lives in the
 * concrete adapter packages.
 */
class StubAdapter implements SecretsAdapter {
  private store = new Map<string, { value: string; createdAt: Date; version: number }>();
  private auditEntries: AccessLogEntry[] = [];

  private id(t: string, c: string, k: string) {
    return `${t}::${c}::${k}`;
  }

  async put(t: string, c: string, k: string, v: string) {
    const id = this.id(t, c, k);
    const prev = this.store.get(id);
    const version = (prev?.version ?? 0) + 1;
    this.store.set(id, { value: v, createdAt: new Date(), version });
    return { secretRef: id, version };
  }

  async get(t: string, c: string, k: string, ctx: AccessContext) {
    const id = this.id(t, c, k);
    const v = this.store.get(id);
    this.auditEntries.push({
      tenantId: t, category: c, key: k,
      callerType: ctx.callerType, callerId: ctx.callerId, reason: ctx.reason,
      grantedAt: new Date(), ok: v !== undefined,
      ...(v === undefined ? { errorClass: 'not_found' as const } : {}),
    });
    if (!v) throw new Error('missing');
    return v.value;
  }

  async list(t: string, c?: string): Promise<SecretMetadata[]> {
    const prefix = c ? `${t}::${c}::` : `${t}::`;
    const out: SecretMetadata[] = [];
    for (const [id, v] of this.store) {
      if (!id.startsWith(prefix)) continue;
      const [, cat, k] = id.split('::');
      if (!cat || !k) continue;
      out.push({ key: k, category: cat, secretRef: id, createdAt: v.createdAt, version: v.version });
    }
    return out;
  }

  async rotate(t: string, c: string, k: string) {
    const v = this.store.get(this.id(t, c, k));
    if (!v) throw new Error('missing');
    v.version += 1;
    return { rotatedAt: new Date(), version: v.version };
  }

  async delete(t: string, c: string, k: string) {
    this.store.delete(this.id(t, c, k));
  }

  async deleteAllForTenant(t: string) {
    let n = 0;
    for (const id of [...this.store.keys()]) {
      if (id.startsWith(`${t}::`)) { this.store.delete(id); n++; }
    }
    return { deletedCount: n, tenantTombstoneRef: `tomb_${t}` };
  }

  async auditLog(t: string) {
    return this.auditEntries.filter((e) => e.tenantId === t);
  }

  async ping() {
    return { ok: true, latencyMs: 0, backend: 'stub' };
  }
}

describe('SecretsAdapter interface (in-memory witness)', () => {
  it('is implementable', async () => {
    const a: SecretsAdapter = new StubAdapter();
    const ctx: AccessContext = { callerType: 'agent', callerId: 'a', reason: 'r' };
    await a.put('t1', 'cloud.aws', 'access_key', 'AKIA');
    expect(await a.get('t1', 'cloud.aws', 'access_key', ctx)).toBe('AKIA');
  });

  it('list returns metadata only', async () => {
    const a = new StubAdapter();
    await a.put('t1', 'cloud.aws', 'access_key', 'AKIA');
    await a.put('t1', 'cloud.aws', 'secret', 's');
    const list = await a.list('t1', 'cloud.aws');
    expect(list).toHaveLength(2);
    for (const m of list) expect(m).not.toHaveProperty('value');
  });

  it('rotate bumps version', async () => {
    const a = new StubAdapter();
    await a.put('t1', 'c', 'k', 'v');
    const r1 = await a.rotate('t1', 'c', 'k');
    const r2 = await a.rotate('t1', 'c', 'k');
    expect(r2.version).toBe(r1.version + 1);
  });

  it('deleteAllForTenant only that tenant', async () => {
    const a = new StubAdapter();
    await a.put('t1', 'c', 'k', 'v');
    await a.put('t2', 'c', 'k', 'v');
    const r = await a.deleteAllForTenant('t1');
    expect(r.deletedCount).toBe(1);
    expect(r.tenantTombstoneRef).toContain('t1');
    expect(await a.list('t2')).toHaveLength(1);
  });

  it('audit log success + failure', async () => {
    const a = new StubAdapter();
    const ctx: AccessContext = { callerType: 'agent', callerId: 'a', reason: 'r' };
    await a.put('t', 'c', 'present', 'v');
    await a.get('t', 'c', 'present', ctx);
    await a.get('t', 'c', 'missing', ctx).catch(() => undefined);
    const log = await a.auditLog('t');
    expect(log).toHaveLength(2);
    expect(log.find((e) => e.key === 'missing')?.errorClass).toBe('not_found');
  });

  it('ping', async () => {
    const a = new StubAdapter();
    expect((await a.ping()).backend).toBe('stub');
  });
});

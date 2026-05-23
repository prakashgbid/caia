import { describe, it, expect } from 'vitest';
import {
  AccessContextSchema,
  AccessLogEntrySchema,
  CallerTypeSchema,
  CategorySchema,
  DeleteAllForTenantOptionsSchema,
  DeleteAllResultSchema,
  DeleteOptionsSchema,
  ErrorClassSchema,
  KeySchema,
  PingResultSchema,
  PutOptionsSchema,
  PutResultSchema,
  RotateResultSchema,
  SecretMetadataSchema,
  SecretValueSchema,
  TenantIdSchema,
} from '../src/types.js';

describe('CallerTypeSchema', () => {
  it('accepts agent', () => {
    expect(CallerTypeSchema.parse('agent')).toBe('agent');
  });
  it('accepts deploy-worker', () => {
    expect(CallerTypeSchema.parse('deploy-worker')).toBe('deploy-worker');
  });
  it('rejects an unknown caller type', () => {
    expect(() => CallerTypeSchema.parse('hacker')).toThrow();
  });
});

describe('AccessContextSchema', () => {
  it('accepts the minimal required envelope', () => {
    const ctx = AccessContextSchema.parse({
      callerType: 'agent',
      callerId: 'coding-agent',
      reason: 'deploy to prod',
    });
    expect(ctx.callerType).toBe('agent');
  });
  it('accepts the full envelope', () => {
    const ctx = AccessContextSchema.parse({
      callerType: 'deploy-worker',
      callerId: 'worker-pod-7',
      ticketId: 'sps-2026-05-23-001',
      reason: 'push docker image',
      capabilityTokenId: 'token-abcdef12',
      requesterIp: '10.0.0.7',
    });
    expect(ctx.ticketId).toBe('sps-2026-05-23-001');
  });
  it('rejects when reason exceeds 500 chars', () => {
    expect(() =>
      AccessContextSchema.parse({
        callerType: 'agent',
        callerId: 'a',
        reason: 'x'.repeat(501),
      }),
    ).toThrow();
  });
  it('rejects empty reason', () => {
    expect(() =>
      AccessContextSchema.parse({ callerType: 'agent', callerId: 'a', reason: '' }),
    ).toThrow();
  });
  it('rejects empty callerId', () => {
    expect(() =>
      AccessContextSchema.parse({ callerType: 'agent', callerId: '', reason: 'ok' }),
    ).toThrow();
  });
  it('rejects an invalid callerType', () => {
    expect(() =>
      AccessContextSchema.parse({ callerType: 'evil', callerId: 'a', reason: 'r' }),
    ).toThrow();
  });
  it('rejects short capabilityTokenId', () => {
    expect(() =>
      AccessContextSchema.parse({
        callerType: 'agent',
        callerId: 'a',
        reason: 'r',
        capabilityTokenId: 'short',
      }),
    ).toThrow();
  });
});

describe('SecretMetadataSchema', () => {
  it('accepts minimal record', () => {
    const m = SecretMetadataSchema.parse({
      key: 'k',
      category: 'cloud.aws',
      secretRef: 'pk_123',
      createdAt: new Date(),
    });
    expect(m.version).toBeUndefined();
  });
  it('accepts full record', () => {
    const m = SecretMetadataSchema.parse({
      key: 'token',
      category: 'cloud.cf',
      secretRef: 'pk_456',
      createdAt: new Date(),
      lastAccessedAt: new Date(),
      lastRotatedAt: new Date(),
      version: 3,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(m.version).toBe(3);
  });
  it('rejects negative version', () => {
    expect(() =>
      SecretMetadataSchema.parse({
        key: 'k', category: 'c', secretRef: 'r', createdAt: new Date(), version: -1,
      }),
    ).toThrow();
  });
});

describe('AccessLogEntrySchema', () => {
  it('accepts successful read', () => {
    const e = AccessLogEntrySchema.parse({
      tenantId: 'a', category: 'c', key: 'k', callerType: 'agent',
      callerId: 'a', reason: 'r', grantedAt: new Date(), ok: true,
    });
    expect(e.ok).toBe(true);
  });
  it('accepts failed read with errorClass', () => {
    const e = AccessLogEntrySchema.parse({
      tenantId: 'a', category: 'c', key: 'k', callerType: 'agent',
      callerId: 'a', reason: 'r', grantedAt: new Date(),
      ok: false, errorClass: 'not_found',
    });
    expect(e.errorClass).toBe('not_found');
  });
  it('rejects invalid errorClass', () => {
    expect(() =>
      AccessLogEntrySchema.parse({
        tenantId: 'a', category: 'c', key: 'k', callerType: 'agent',
        callerId: 'a', reason: 'r', grantedAt: new Date(), ok: false, errorClass: 'nope',
      }),
    ).toThrow();
  });
});

describe('ErrorClassSchema', () => {
  it('accepts all four classes', () => {
    for (const cls of ['not_found', 'policy_denied', 'rate_limited', 'provider_error'] as const) {
      expect(ErrorClassSchema.parse(cls)).toBe(cls);
    }
  });
});

describe('PutOptionsSchema', () => {
  it('accepts empty', () => {
    expect(PutOptionsSchema.parse({})).toEqual({});
  });
  it('accepts ttl + replace', () => {
    expect(PutOptionsSchema.parse({ ttlSeconds: 60, replace: true })).toEqual({
      ttlSeconds: 60, replace: true,
    });
  });
  it('rejects negative ttl', () => {
    expect(() => PutOptionsSchema.parse({ ttlSeconds: -1 })).toThrow();
  });
  it('rejects ttl > 1 year', () => {
    expect(() => PutOptionsSchema.parse({ ttlSeconds: 60 * 60 * 24 * 366 })).toThrow();
  });
});

describe('Delete options', () => {
  it('purge', () => {
    expect(DeleteOptionsSchema.parse({ purge: true }).purge).toBe(true);
  });
  it('dryRun', () => {
    expect(DeleteAllForTenantOptionsSchema.parse({ dryRun: true }).dryRun).toBe(true);
  });
});

describe('Return shapes', () => {
  it('PutResult', () => {
    expect(PutResultSchema.parse({ secretRef: 'r' })).toEqual({ secretRef: 'r' });
  });
  it('RotateResult', () => {
    expect(RotateResultSchema.parse({ rotatedAt: new Date(), version: 2 }).version).toBe(2);
  });
  it('DeleteAllResult', () => {
    expect(
      DeleteAllResultSchema.parse({ deletedCount: 7, tenantTombstoneRef: 't' }).deletedCount,
    ).toBe(7);
  });
  it('PingResult', () => {
    expect(PingResultSchema.parse({ ok: true, latencyMs: 12, backend: 'pg' }).backend).toBe('pg');
  });
});

describe('TenantIdSchema', () => {
  it('accepts ok', () => expect(TenantIdSchema.parse('tenant-007')).toBe('tenant-007'));
  it('rejects uppercase', () => expect(() => TenantIdSchema.parse('Tenant')).toThrow());
  it('rejects empty', () => expect(() => TenantIdSchema.parse('')).toThrow());
  it('rejects leading hyphen', () => expect(() => TenantIdSchema.parse('-abc')).toThrow());
  it('rejects >64', () => expect(() => TenantIdSchema.parse('a'.repeat(65))).toThrow());
});

describe('CategorySchema', () => {
  it('accepts dotted', () => expect(CategorySchema.parse('cloud.aws')).toBe('cloud.aws'));
  it('rejects uppercase', () => expect(() => CategorySchema.parse('Cloud')).toThrow());
});

describe('KeySchema', () => {
  it('mixed case', () => expect(KeySchema.parse('ACCESS_KEY_ID')).toBe('ACCESS_KEY_ID'));
  it('dot ns', () => expect(KeySchema.parse('cloud.aws.x')).toBe('cloud.aws.x'));
  it('rejects leading hyphen', () => expect(() => KeySchema.parse('-key')).toThrow());
});

describe('SecretValueSchema', () => {
  it('non-empty', () => expect(SecretValueSchema.parse('hunter2')).toBe('hunter2'));
  it('rejects empty', () => expect(() => SecretValueSchema.parse('')).toThrow());
});

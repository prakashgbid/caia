import { describe, it, expect } from 'vitest';
import { PostgresAuditLogger, NoopAuditLogger } from '../../src/audit.js';
import { MockPool } from './mock-pool.js';

describe('PostgresAuditLogger', () => {
  it('writes a row with all fields', async () => {
    const pool = new MockPool();
    const logger = new PostgresAuditLogger(pool);
    await logger.write({
      tenantId: 't1',
      category: 'cloud.aws',
      key: 'access_key',
      backend: 'postgres',
      action: 'get',
      callerContext: {
        callerType: 'agent',
        callerId: 'coding-agent',
        ticketId: 'sps-001',
        reason: 'deploy',
        capabilityTokenId: 'tok-abcdef12',
        requesterIp: '10.0.0.1',
      },
      ok: true,
      providerTrace: 'ref-42',
    });
    expect(pool.audit).toHaveLength(1);
    expect(pool.audit[0]).toMatchObject({
      tenant_id: 't1',
      category: 'cloud.aws',
      key: 'access_key',
      action: 'get',
      caller_type: 'agent',
      caller_id: 'coding-agent',
      ticket_id: 'sps-001',
      capability_token_id: 'tok-abcdef12',
      requester_ip: '10.0.0.1',
      ok: true,
      provider_trace: 'ref-42',
    });
  });

  it('writes failure with errorClass', async () => {
    const pool = new MockPool();
    const logger = new PostgresAuditLogger(pool);
    await logger.write({
      tenantId: 't1',
      category: 'c',
      key: 'k',
      backend: 'postgres',
      action: 'get',
      callerContext: { callerType: 'agent', callerId: 'a', reason: 'r' },
      ok: false,
      errorClass: 'not_found',
    });
    expect(pool.audit[0]?.ok).toBe(false);
    expect(pool.audit[0]?.error_class).toBe('not_found');
  });

  it('swallows insert errors via onError', async () => {
    const pool = new MockPool();
    pool.failNext = {
      match: /INSERT INTO caia_meta\.audit_log/,
      err: new Error('boom'),
    };
    const errors: unknown[] = [];
    const logger = new PostgresAuditLogger(pool, (e) => errors.push(e));
    await expect(
      logger.write({
        tenantId: 't',
        category: 'c',
        key: 'k',
        backend: 'postgres',
        action: 'get',
        callerContext: { callerType: 'agent', callerId: 'a', reason: 'r' },
        ok: true,
      }),
    ).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
  });

  it('uses null for missing optional fields', async () => {
    const pool = new MockPool();
    const logger = new PostgresAuditLogger(pool);
    await logger.write({
      tenantId: 't',
      category: 'c',
      key: 'k',
      backend: 'postgres',
      action: 'put',
      callerContext: { callerType: 'agent', callerId: 'a', reason: 'r' },
      ok: true,
    });
    expect(pool.audit[0]?.ticket_id).toBeNull();
    expect(pool.audit[0]?.capability_token_id).toBeNull();
    expect(pool.audit[0]?.requester_ip).toBeNull();
    expect(pool.audit[0]?.error_class).toBeNull();
    expect(pool.audit[0]?.provider_trace).toBeNull();
  });
});

describe('NoopAuditLogger', () => {
  it('does nothing', async () => {
    const logger = new NoopAuditLogger();
    await expect(
      logger.write({
        tenantId: 't',
        category: 'c',
        key: 'k',
        backend: 'postgres',
        action: 'get',
        callerContext: { callerType: 'agent', callerId: 'a', reason: 'r' },
        ok: true,
      }),
    ).resolves.toBeUndefined();
  });
});

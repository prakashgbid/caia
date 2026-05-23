import { describe, it, expect } from 'vitest';
import { InMemoryAuditLogger, NoopAuditLogger } from '../../src/audit.js';

const sample = {
  tenantId: 't',
  category: 'c',
  key: 'k',
  backend: 'infisical',
  action: 'get' as const,
  callerContext: {
    callerType: 'agent' as const,
    callerId: 'a',
    reason: 'r',
  },
  ok: true,
};

describe('NoopAuditLogger', () => {
  it('write is a no-op', async () => {
    const logger = new NoopAuditLogger();
    await expect(logger.write(sample)).resolves.toBeUndefined();
  });
});

describe('InMemoryAuditLogger', () => {
  it('accumulates events', async () => {
    const logger = new InMemoryAuditLogger();
    await logger.write(sample);
    await logger.write({ ...sample, ok: false, errorClass: 'not_found' });
    expect(logger.events).toHaveLength(2);
    expect(logger.events[1]?.ok).toBe(false);
    expect(logger.events[1]?.errorClass).toBe('not_found');
  });

  it('preserves order', async () => {
    const logger = new InMemoryAuditLogger();
    for (let i = 0; i < 5; i++) {
      await logger.write({ ...sample, key: `k${i}` });
    }
    expect(logger.events.map((e) => e.key)).toEqual([
      'k0',
      'k1',
      'k2',
      'k3',
      'k4',
    ]);
  });
});

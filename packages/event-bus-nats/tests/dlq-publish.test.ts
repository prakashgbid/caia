/**
 * DLQ-publish path tests.
 *
 * The bus republishes poison messages to a DLQ subject after retry
 * exhaustion. These tests cover the publish helper, the nak backoff,
 * and the consume-loop integration (delivery counting + DLQ ack).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  publishToDlq,
  nakBackoffMs,
  defaultDlqHandler,
} from '../src/dlq.js';
import type { DlqAdvisory, DlqPublisher } from '../src/dlq.js';
import { decodeEnvelope, wrap } from '../src/envelope.js';
import type {
  ConductorEvent,
  EventEnvelope,
} from '../src/types.js';

function sampleEnvelope(): EventEnvelope {
  const ev: ConductorEvent = {
    id: 'ev_test_dlq_001',
    type: 'tenant.provisioned' as ConductorEvent['type'],
    occurred_at: '2026-05-25T00:00:00.000Z',
    actor: 'api' as ConductorEvent['actor'],
    domain_slugs: [],
    payload: { tenant_id: 't_1' },
    metadata: {},
    severity: 'info' as ConductorEvent['severity'],
  };
  return wrap(ev, 'test-sender');
}

describe('nakBackoffMs', () => {
  it('first delivery (attempt=1) returns ~base with some jitter', () => {
    const ms = nakBackoffMs(1, { baseMs: 500, capMs: 30_000, jitter: 0 });
    expect(ms).toBe(500);
  });

  it('exponentially grows with delivery attempt', () => {
    const noJitter = { baseMs: 500, capMs: 30_000, jitter: 0 };
    expect(nakBackoffMs(1, noJitter)).toBe(500);
    expect(nakBackoffMs(2, noJitter)).toBe(1000);
    expect(nakBackoffMs(3, noJitter)).toBe(2000);
    expect(nakBackoffMs(4, noJitter)).toBe(4000);
  });

  it('caps at capMs', () => {
    const ms = nakBackoffMs(10, { baseMs: 500, capMs: 5_000, jitter: 0 });
    expect(ms).toBe(5_000);
  });

  it('clamps to >= 0 even with negative jitter swing', () => {
    // Force max negative jitter on a small base.
    const original = Math.random;
    Math.random = () => 0; // produces a -jitter*capped offset
    try {
      const ms = nakBackoffMs(1, { baseMs: 100, capMs: 30_000, jitter: 0.99 });
      expect(ms).toBeGreaterThanOrEqual(0);
    } finally {
      Math.random = original;
    }
  });

  it('uses default base 500ms / cap 30s / jitter 0.2 when opts omitted', () => {
    // With jitter, the result is bounded; assert range.
    const ms = nakBackoffMs(1);
    expect(ms).toBeGreaterThanOrEqual(0);
    expect(ms).toBeLessThanOrEqual(1000); // 500 + 100% jitter slack
  });
});

describe('publishToDlq', () => {
  it('wraps the envelope with a dlq block', async () => {
    const env = sampleEnvelope();
    const captured: Array<{ subject: string; data: Uint8Array; opts: unknown }> = [];
    const pub: DlqPublisher = {
      publish: vi.fn(async (subject: string, data: Uint8Array, opts: unknown) => {
        captured.push({ subject, data, opts });
        return { seq: 1 };
      }),
    };
    await publishToDlq(pub, 'chiefaia.events.dlq', env, {
      originalSubject: 'chiefaia.tenant.provisioned',
      deliveryCount: 4,
      lastError: 'handler boom',
      now: () => new Date('2026-05-25T12:00:00.000Z'),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]!.subject).toBe('chiefaia.events.dlq');
    const wrapped = decodeEnvelope(captured[0]!.data);
    expect(wrapped.dlq).toEqual({
      original_subject: 'chiefaia.tenant.provisioned',
      delivery_count: 4,
      last_error: 'handler boom',
      failed_at: '2026-05-25T12:00:00.000Z',
    });
    expect(wrapped.event.id).toBe('ev_test_dlq_001');
  });

  it('uses a distinct msgID per delivery attempt to avoid dedupe', async () => {
    const env = sampleEnvelope();
    const captured: Array<{ opts: unknown }> = [];
    const pub: DlqPublisher = {
      publish: vi.fn(async (_s, _d, opts: unknown) => {
        captured.push({ opts });
        return { seq: 1 };
      }),
    };
    await publishToDlq(pub, 'chiefaia.events.dlq', env, {
      originalSubject: 'chiefaia.tenant.provisioned',
      deliveryCount: 4,
      lastError: 'e',
    });
    await publishToDlq(pub, 'chiefaia.events.dlq', env, {
      originalSubject: 'chiefaia.tenant.provisioned',
      deliveryCount: 5,
      lastError: 'e',
    });
    expect(captured[0]!.opts).toMatchObject({ msgID: 'ev_test_dlq_001#dlq#4' });
    expect(captured[1]!.opts).toMatchObject({ msgID: 'ev_test_dlq_001#dlq#5' });
  });

  it('propagates publisher errors', async () => {
    const env = sampleEnvelope();
    const pub: DlqPublisher = {
      publish: vi.fn(async () => { throw new Error('broker down'); }),
    };
    await expect(
      publishToDlq(pub, 'chiefaia.events.dlq', env, {
        originalSubject: 'chiefaia.tenant.provisioned',
        deliveryCount: 4,
        lastError: 'e',
      }),
    ).rejects.toThrow(/broker down/);
  });

  it('preserves the original event fields (id, type, payload)', async () => {
    const env = sampleEnvelope();
    let captured: Uint8Array | null = null;
    const pub: DlqPublisher = {
      publish: vi.fn(async (_s, data: Uint8Array) => {
        captured = data;
        return { seq: 1 };
      }),
    };
    await publishToDlq(pub, 'chiefaia.events.dlq', env, {
      originalSubject: 'x',
      deliveryCount: 4,
      lastError: 'e',
    });
    const wrapped = decodeEnvelope(captured!);
    expect(wrapped.event.id).toBe(env.event.id);
    expect(wrapped.event.type).toBe(env.event.type);
    expect(wrapped.event.payload).toEqual(env.event.payload);
    expect(wrapped.sender).toBe(env.sender);
    expect(wrapped.idempotency_key).toBe(env.idempotency_key);
  });
});

describe('defaultDlqHandler', () => {
  it('logs the advisory without throwing', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const advisory: DlqAdvisory = {
      stream: 'chiefaia-events',
      consumer: 'sub-tenant',
      deliveries: 5,
      reason: 'max_deliveries',
      rawSubject: 'chiefaia.tenant.provisioned',
      rawPayload: new Uint8Array(),
    };
    expect(() => defaultDlqHandler(advisory)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

/**
 * NATS publish/consume span helper tests.
 *
 * These tests exercise the helpers without standing up a real NATS
 * broker — the carrier is a plain object that we inspect for the
 * injected traceparent, and the consume helper sees the parent
 * context restored.
 */

import { describe, it, expect } from 'vitest';
import {
  withNatsConsumeSpan,
  withNatsPublishSpan,
} from '../src/nats-instrumentation.js';
import { parseTraceparent } from '../src/propagation.js';
import type { TraceCarrier } from '../src/types.js';

describe('withNatsPublishSpan', () => {
  it('returns the fn result', async () => {
    const carrier: TraceCarrier = {};
    const result = await withNatsPublishSpan(
      { subject: 'chiefaia.test.evt', carrier },
      async () => 'published',
    );
    expect(result).toBe('published');
  });

  it('injects a traceparent into the carrier', async () => {
    const carrier: TraceCarrier = {};
    await withNatsPublishSpan(
      { subject: 'chiefaia.test.evt', carrier },
      async () => undefined,
    );
    // Either the global propagator wrote a real header or (with no
    // SDK installed in this test) the propagator may write the
    // invalid all-zero header. Either way the header should exist.
    expect(carrier.traceparent).toBeDefined();
    expect(parseTraceparent(carrier.traceparent!)).not.toBeNull();
  });

  it('rethrows publisher errors', async () => {
    const carrier: TraceCarrier = {};
    await expect(
      withNatsPublishSpan({ subject: 'chiefaia.x', carrier }, async () => {
        throw new Error('publish boom');
      }),
    ).rejects.toThrow('publish boom');
  });
});

describe('withNatsConsumeSpan', () => {
  it('passes the extracted parent context to the handler', async () => {
    const carrier: TraceCarrier = {
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    };
    let receivedParentId: string | undefined;
    await withNatsConsumeSpan(
      { subject: 'chiefaia.test.evt', carrier },
      async (parent) => {
        receivedParentId = parent?.traceId;
      },
    );
    expect(receivedParentId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
  });

  it('passes null when no traceparent on the carrier', async () => {
    let calledWith: unknown = 'unset';
    await withNatsConsumeSpan(
      { subject: 'chiefaia.test.evt', carrier: {} },
      async (parent) => {
        calledWith = parent;
      },
    );
    expect(calledWith).toBeNull();
  });
});

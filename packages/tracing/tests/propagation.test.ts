/**
 * W3C TraceContext inject/extract round-trip tests.
 */

import { describe, it, expect } from 'vitest';
import {
  extractContext,
  injectContext,
  parseTraceparent,
} from '../src/propagation.js';
import type { TraceCarrier } from '../src/types.js';

describe('parseTraceparent', () => {
  it('parses a well-formed traceparent', () => {
    const parsed = parseTraceparent(
      '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    );
    expect(parsed).toEqual({
      version: '00',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
      flags: '01',
    });
  });

  it('returns null on malformed traceparent', () => {
    expect(parseTraceparent('not-a-traceparent')).toBeNull();
    expect(parseTraceparent('')).toBeNull();
    expect(parseTraceparent('00-tooshort-00f067aa0ba902b7-01')).toBeNull();
  });
});

describe('injectContext', () => {
  it('injects a synthetic spanCtx into an empty carrier', () => {
    const carrier: TraceCarrier = {};
    const ret = injectContext(carrier, {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
    expect(ret).toBe(carrier); // mutates + returns same object
    expect(carrier.traceparent).toBeDefined();
    const parsed = parseTraceparent(carrier.traceparent!);
    expect(parsed?.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(parsed?.spanId).toBe('00f067aa0ba902b7');
  });

  it('is a no-op when no active span and no explicit spanCtx', () => {
    const carrier: TraceCarrier = {};
    injectContext(carrier);
    // With no span anywhere, the propagator either omits the
    // header entirely or writes the invalid all-zero one. Either
    // way, parseTraceparent should not give back a usable traceId.
    if (carrier.traceparent) {
      const parsed = parseTraceparent(carrier.traceparent);
      // Invalid span ids are 16 zeros; trace ids 32 zeros.
      expect(parsed?.traceId).toMatch(/^0+$/);
    } else {
      expect(carrier.traceparent).toBeUndefined();
    }
  });
});

describe('extractContext', () => {
  it('round-trips inject -> extract', () => {
    const carrier: TraceCarrier = {};
    injectContext(carrier, {
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
      spanId: '00f067aa0ba902b7',
    });
    const extracted = extractContext(carrier);
    expect(extracted).not.toBeNull();
    expect(extracted!.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(extracted!.spanId).toBe('00f067aa0ba902b7');
  });

  it('returns null when carrier has no traceparent', () => {
    expect(extractContext({})).toBeNull();
    expect(extractContext({ unrelated: 'value' })).toBeNull();
  });

  it('returns null when carrier has an unparseable traceparent', () => {
    expect(extractContext({ traceparent: 'garbage' })).toBeNull();
  });
});

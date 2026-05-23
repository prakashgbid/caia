import { describe, expect, it } from 'vitest';

import { hashPayload } from '../src/hash.js';

describe('hashPayload', () => {
  it('produces a 64-char hex digest', () => {
    const h = hashPayload({ a: 1 });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable across key order', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('differs when values differ', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it('handles nested objects deterministically', () => {
    const left = hashPayload({ outer: { y: 2, x: 1 } });
    const right = hashPayload({ outer: { x: 1, y: 2 } });
    expect(left).toBe(right);
  });

  it('preserves array order', () => {
    const a = hashPayload({ list: [1, 2, 3] });
    const b = hashPayload({ list: [3, 2, 1] });
    expect(a).not.toBe(b);
  });

  it('treats non-finite numbers as null', () => {
    const a = hashPayload({ v: Number.NaN });
    const b = hashPayload({ v: null as unknown as number });
    expect(a).toBe(b);
  });

  it('hash of empty object is fixed', () => {
    expect(hashPayload({})).toBe(hashPayload({}));
  });
});

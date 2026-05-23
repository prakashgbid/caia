import { describe, expect, it } from 'vitest';

import { canonicalJsonStringify, sha256, sha256Of } from '../src/index.js';

describe('content-hash helpers', () => {
  it('sha256 returns a sha256: prefixed hex string', () => {
    const h = sha256(new Uint8Array([1, 2, 3]));
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('sha256 is deterministic on identical bytes', () => {
    const b = new Uint8Array([9, 9, 9, 9]);
    expect(sha256(b)).toBe(sha256(b));
  });

  it('sha256 differs across different bytes', () => {
    expect(sha256(new Uint8Array([1]))).not.toBe(sha256(new Uint8Array([2])));
  });

  it('canonicalJsonStringify sorts keys', () => {
    expect(canonicalJsonStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('canonicalJsonStringify preserves array order', () => {
    expect(canonicalJsonStringify([3, 1, 2])).toBe('[3,1,2]');
  });

  it('canonicalJsonStringify is recursive', () => {
    const s = canonicalJsonStringify({ z: { b: 1, a: 2 }, a: [{ y: 1, x: 2 }] });
    expect(s).toBe('{"a":[{"x":2,"y":1}],"z":{"a":2,"b":1}}');
  });

  it('sha256Of yields the same hash regardless of insertion order', () => {
    expect(sha256Of({ a: 1, b: 2 })).toBe(sha256Of({ b: 2, a: 1 }));
  });

  it('sha256Of differs across different payloads', () => {
    expect(sha256Of({ a: 1 })).not.toBe(sha256Of({ a: 2 }));
  });
});

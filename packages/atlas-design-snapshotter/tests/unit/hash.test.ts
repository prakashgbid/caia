import { describe, expect, it } from 'vitest';
import { canonicalJson, hashValue, sha256 } from '../../src/hash.js';

describe('hash utilities', () => {
  it('sha256 produces a sha256: prefixed hex string', () => {
    const h = sha256('hello');
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('sha256 is deterministic across calls', () => {
    expect(sha256('hello')).toEqual(sha256('hello'));
  });

  it('canonicalJson sorts keys recursively', () => {
    const a = { b: 2, a: 1, nested: { y: 'y', x: 'x' } };
    const b = { a: 1, b: 2, nested: { x: 'x', y: 'y' } };
    expect(canonicalJson(a)).toEqual(canonicalJson(b));
  });

  it('hashValue collides on key-permuted equal objects', () => {
    const a = { foo: { x: 1, y: 2 }, bar: [1, 2, 3] };
    const b = { bar: [1, 2, 3], foo: { y: 2, x: 1 } };
    expect(hashValue(a)).toEqual(hashValue(b));
  });

  it('hashValue differs when content actually differs', () => {
    expect(hashValue({ x: 1 })).not.toEqual(hashValue({ x: 2 }));
  });
});

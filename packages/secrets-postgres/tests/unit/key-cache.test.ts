import { describe, it, expect } from 'vitest';
import { TenantKeyCache } from '../../src/key-cache.js';

const key32 = (b: number): Buffer => Buffer.alloc(32, b);

describe('TenantKeyCache — basics', () => {
  it('get returns undefined on miss', () => {
    const c = new TenantKeyCache();
    expect(c.get('t')).toBeUndefined();
  });
  it('set then get returns the key', () => {
    const c = new TenantKeyCache();
    c.set('t', key32(1));
    const got = c.get('t');
    expect(got).toBeDefined();
    expect(got!.equals(key32(1))).toBe(true);
  });
  it('returns a copy (mutating cached buffer does not leak)', () => {
    const c = new TenantKeyCache();
    const original = key32(1);
    c.set('t', original);
    original.fill(0); // mutate the source
    const got = c.get('t');
    expect(got!.equals(key32(1))).toBe(true);
  });
});

describe('TenantKeyCache — TTL', () => {
  it('expired entry returns undefined', () => {
    let now = 1000;
    const c = new TenantKeyCache({ ttlMs: 100, now: () => now });
    c.set('t', key32(2));
    now = 1100; // exactly at expiry
    expect(c.get('t')).toBeUndefined();
  });
  it('non-expired returns the key', () => {
    let now = 1000;
    const c = new TenantKeyCache({ ttlMs: 1000, now: () => now });
    c.set('t', key32(2));
    now = 1500;
    expect(c.get('t')).toBeDefined();
  });
  it('expired entry is dropped from cache', () => {
    let now = 1000;
    const c = new TenantKeyCache({ ttlMs: 100, now: () => now });
    c.set('t', key32(3));
    expect(c.size).toBe(1);
    now = 2000;
    c.get('t');
    expect(c.size).toBe(0);
  });
});

describe('TenantKeyCache — LRU eviction', () => {
  it('evicts oldest when at capacity', () => {
    const c = new TenantKeyCache({ maxEntries: 2 });
    c.set('a', key32(1));
    c.set('b', key32(2));
    c.set('c', key32(3));
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBeDefined();
    expect(c.get('c')).toBeDefined();
  });
  it('accessing an entry moves it to most-recently-used', () => {
    const c = new TenantKeyCache({ maxEntries: 2 });
    c.set('a', key32(1));
    c.set('b', key32(2));
    c.get('a'); // bump 'a'
    c.set('c', key32(3));
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBeDefined();
  });
  it('size respects capacity', () => {
    const c = new TenantKeyCache({ maxEntries: 3 });
    c.set('a', key32(1));
    c.set('b', key32(2));
    c.set('c', key32(3));
    c.set('d', key32(4));
    expect(c.size).toBe(3);
  });
});

describe('TenantKeyCache — invalidate (crypto-shred)', () => {
  it('invalidate returns true when key exists', () => {
    const c = new TenantKeyCache();
    c.set('t', key32(1));
    expect(c.invalidate('t')).toBe(true);
  });
  it('invalidate returns false when key missing', () => {
    const c = new TenantKeyCache();
    expect(c.invalidate('nope')).toBe(false);
  });
  it('after invalidate, get returns undefined', () => {
    const c = new TenantKeyCache();
    c.set('t', key32(1));
    c.invalidate('t');
    expect(c.get('t')).toBeUndefined();
  });
  it('clear empties everything', () => {
    const c = new TenantKeyCache();
    c.set('a', key32(1));
    c.set('b', key32(2));
    c.clear();
    expect(c.size).toBe(0);
  });
});

describe('TenantKeyCache — re-set overrides', () => {
  it('setting twice updates the value', () => {
    const c = new TenantKeyCache();
    c.set('t', key32(1));
    c.set('t', key32(2));
    expect(c.get('t')!.equals(key32(2))).toBe(true);
    expect(c.size).toBe(1);
  });
});

describe('TenantKeyCache — defaults', () => {
  it('default capacity is 1024', () => {
    const c = new TenantKeyCache();
    for (let i = 0; i < 1024; i++) c.set(`t${i}`, key32(1));
    c.set('t-overflow', key32(1));
    expect(c.size).toBe(1024);
  });
});

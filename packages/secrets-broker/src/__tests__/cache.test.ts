import { TtlCache } from '../cache';

describe('TtlCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('stores and retrieves a value within TTL', () => {
    const c = new TtlCache<string>();
    c.set('k', 'hello', 10);
    expect(c.get('k')).toBe('hello');
  });

  it('returns undefined after TTL expires', () => {
    const c = new TtlCache<string>();
    c.set('k', 'hello', 5);
    jest.advanceTimersByTime(6000);
    expect(c.get('k')).toBeUndefined();
  });

  it('has() returns false after expiry', () => {
    const c = new TtlCache<string>();
    c.set('k', 'v', 1);
    jest.advanceTimersByTime(2000);
    expect(c.has('k')).toBe(false);
  });

  it('has() returns true within TTL', () => {
    const c = new TtlCache<string>();
    c.set('k', 'v', 60);
    expect(c.has('k')).toBe(true);
  });

  it('returns remaining TTL in seconds', () => {
    const c = new TtlCache<number>();
    c.set('k', 42, 30);
    jest.advanceTimersByTime(10_000);
    expect(c.ttlRemainingSeconds('k')).toBe(20);
  });

  it('returns 0 remaining TTL for missing key', () => {
    const c = new TtlCache<string>();
    expect(c.ttlRemainingSeconds('missing')).toBe(0);
  });

  it('returns expiresAt timestamp', () => {
    const c = new TtlCache<string>();
    const before = Date.now();
    c.set('k', 'v', 60);
    const after = Date.now();
    const exp = c.expiresAt('k');
    expect(exp).toBeGreaterThanOrEqual(before + 60_000);
    expect(exp).toBeLessThanOrEqual(after + 60_000);
  });

  it('returns 0 expiresAt for missing key', () => {
    const c = new TtlCache<string>();
    expect(c.expiresAt('nope')).toBe(0);
  });

  it('delete removes the key', () => {
    const c = new TtlCache<string>();
    c.set('k', 'v', 60);
    c.delete('k');
    expect(c.get('k')).toBeUndefined();
  });

  it('clear removes all keys', () => {
    const c = new TtlCache<string>();
    c.set('a', '1', 60);
    c.set('b', '2', 60);
    c.clear();
    expect(c.size()).toBe(0);
  });

  it('size() does not count expired entries', () => {
    const c = new TtlCache<string>();
    c.set('a', '1', 60);
    c.set('b', '2', 1);
    jest.advanceTimersByTime(2000);
    expect(c.size()).toBe(1);
  });

  it('size() counts valid entries', () => {
    const c = new TtlCache<string>();
    c.set('x', 'v', 60);
    c.set('y', 'v', 60);
    expect(c.size()).toBe(2);
  });
});

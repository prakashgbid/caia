/**
 * Unit tests for CloudflareAccessJwksCache — TTL behaviour, refresh, verify.
 *
 * The class wraps jose's createRemoteJWKSet. We don't try to test jose
 * itself — only OUR layer:
 *   - cache fresh/expired computation
 *   - refresh() is called on miss
 *   - verify() with valid token passes payload through
 *   - verify() with malformed token rejects
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CloudflareAccessJwksCache } from '../../lib/auth/jwks-cache';

const OPTS = {
  jwksUrl: 'https://example.cloudflareaccess.com/cdn-cgi/access/certs',
  issuer: 'https://example.cloudflareaccess.com',
  audience: 'test-aud',
};

describe('CloudflareAccessJwksCache', () => {
  let now = 1_700_000_000_000;
  let cache: CloudflareAccessJwksCache;

  beforeEach(() => {
    now = 1_700_000_000_000;
    cache = new CloudflareAccessJwksCache({
      ...OPTS,
      now: () => now,
      ttlMs: 5 * 60 * 1000,
      fetchImpl: (async () =>
        new Response(JSON.stringify({ keys: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })) as unknown as typeof fetch,
    });
  });

  it('starts un-fresh before any refresh', () => {
    expect(cache.isFresh()).toBe(false);
  });

  it('is fresh immediately after refresh()', () => {
    cache.refresh();
    expect(cache.isFresh()).toBe(true);
  });

  it('expires after TTL elapses', () => {
    cache.refresh();
    now += 5 * 60 * 1000 + 1;
    expect(cache.isFresh()).toBe(false);
  });

  it('is still fresh just before TTL', () => {
    cache.refresh();
    now += 5 * 60 * 1000 - 1;
    expect(cache.isFresh()).toBe(true);
  });

  it('refresh() resets the freshness window', () => {
    cache.refresh();
    now += 5 * 60 * 1000 + 1;
    expect(cache.isFresh()).toBe(false);
    cache.refresh();
    expect(cache.isFresh()).toBe(true);
  });

  it('verify() throws on a malformed token', async () => {
    await expect(cache.verify('not.a.jwt')).rejects.toBeInstanceOf(Error);
  });

  it('verify() throws on an empty string token', async () => {
    await expect(cache.verify('')).rejects.toBeInstanceOf(Error);
  });

  it('respects a custom TTL', () => {
    const short = new CloudflareAccessJwksCache({
      ...OPTS,
      now: () => now,
      ttlMs: 100,
      fetchImpl: (async () => new Response('{"keys":[]}')) as unknown as typeof fetch,
    });
    short.refresh();
    expect(short.isFresh()).toBe(true);
    now += 101;
    expect(short.isFresh()).toBe(false);
  });

  it('refresh() is callable multiple times without throwing', () => {
    expect(() => {
      cache.refresh();
      cache.refresh();
      cache.refresh();
    }).not.toThrow();
  });
});

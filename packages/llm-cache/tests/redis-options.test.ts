// Tests for RedisBackendOptions wiring and RedisBackend.fromEnv() factory.
// No real Redis server needed — the redis module is mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Capture createClient calls so we can assert option forwarding.
// ---------------------------------------------------------------------------

const mockConnect = vi.fn().mockResolvedValue(undefined);

vi.mock('redis', () => ({
  createClient: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    zAdd: vi.fn().mockResolvedValue(1),
    zRange: vi.fn().mockResolvedValue([]),
    zCard: vi.fn().mockResolvedValue(0),
    zRemRangeByScore: vi.fn().mockResolvedValue(0),
    keys: vi.fn().mockResolvedValue([]),
  })),
}));

const { createClient } = await import('redis');
const { RedisBackend } = await import('../src/backends/redis.js');

type CreateClientSpy = ReturnType<typeof vi.fn>;

function lastCallArg(): Record<string, unknown> {
  const spy = createClient as CreateClientSpy;
  return spy.mock.calls[spy.mock.calls.length - 1]?.[0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Constructor option wiring
// ---------------------------------------------------------------------------

describe('RedisBackend — option wiring', () => {
  it('forwards url', () => {
    new RedisBackend({ url: 'redis://myhost:6380' });
    expect(lastCallArg()).toMatchObject({ url: 'redis://myhost:6380' });
  });

  it('forwards password when provided', () => {
    new RedisBackend({ url: 'redis://h', password: 's3cr3t' });
    expect(lastCallArg()).toMatchObject({ password: 's3cr3t' });
  });

  it('omits password key when not provided', () => {
    new RedisBackend({ url: 'redis://h' });
    expect(lastCallArg()).not.toHaveProperty('password');
  });

  it('forwards username when provided', () => {
    new RedisBackend({ url: 'redis://h', username: 'alice' });
    expect(lastCallArg()).toMatchObject({ username: 'alice' });
  });

  it('omits username key when not provided', () => {
    new RedisBackend({ url: 'redis://h' });
    expect(lastCallArg()).not.toHaveProperty('username');
  });

  it('forwards database index when provided', () => {
    new RedisBackend({ url: 'redis://h', database: 3 });
    expect(lastCallArg()).toMatchObject({ database: 3 });
  });

  it('omits database key when not provided', () => {
    new RedisBackend({ url: 'redis://h' });
    expect(lastCallArg()).not.toHaveProperty('database');
  });

  it('defaults socket.connectTimeout to 5000', () => {
    new RedisBackend({ url: 'redis://h' });
    expect(lastCallArg()).toMatchObject({ socket: { connectTimeout: 5_000 } });
  });

  it('respects custom socket.connectTimeout', () => {
    new RedisBackend({ url: 'redis://h', socket: { connectTimeout: 2_000 } });
    expect(lastCallArg()).toMatchObject({ socket: { connectTimeout: 2_000 } });
  });

  it('forwards socket.tls when true', () => {
    new RedisBackend({ url: 'redis://h', socket: { tls: true } });
    expect(lastCallArg()).toMatchObject({ socket: { tls: true } });
  });

  it('omits socket.tls when not set', () => {
    new RedisBackend({ url: 'redis://h' });
    const socket = lastCallArg()['socket'] as Record<string, unknown>;
    expect(socket).not.toHaveProperty('tls');
  });

  it('forwards socket.keepAlive when provided', () => {
    new RedisBackend({ url: 'redis://h', socket: { keepAlive: 5_000 } });
    expect(lastCallArg()).toMatchObject({ socket: { keepAlive: 5_000 } });
  });

  it('omits socket.keepAlive when not set', () => {
    new RedisBackend({ url: 'redis://h' });
    const socket = lastCallArg()['socket'] as Record<string, unknown>;
    expect(socket).not.toHaveProperty('keepAlive');
  });
});

// ---------------------------------------------------------------------------
// RedisBackend.fromEnv()
// ---------------------------------------------------------------------------

describe('RedisBackend.fromEnv()', () => {
  it('throws when REDIS_URL is missing', () => {
    expect(() => RedisBackend.fromEnv({})).toThrow('REDIS_URL is required');
  });

  it('creates backend from REDIS_URL alone', () => {
    const b = RedisBackend.fromEnv({ REDIS_URL: 'redis://localhost:6379' });
    expect(b).toBeInstanceOf(RedisBackend);
    expect(lastCallArg()).toMatchObject({ url: 'redis://localhost:6379' });
  });

  it('forwards REDIS_PASSWORD', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_PASSWORD: 'pw' });
    expect(lastCallArg()).toMatchObject({ password: 'pw' });
  });

  it('forwards REDIS_USERNAME', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_USERNAME: 'bob' });
    expect(lastCallArg()).toMatchObject({ username: 'bob' });
  });

  it('parses REDIS_DB as integer', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_DB: '5' });
    expect(lastCallArg()).toMatchObject({ database: 5 });
  });

  it('rejects REDIS_DB > 15', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_DB: '99' }),
    ).toThrow('REDIS_DB must be an integer 0–15');
  });

  it('rejects non-numeric REDIS_DB', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_DB: 'oops' }),
    ).toThrow('REDIS_DB must be an integer 0–15');
  });

  it('rejects REDIS_DB < 0', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_DB: '-1' }),
    ).toThrow('REDIS_DB must be an integer 0–15');
  });

  it('enables TLS when REDIS_TLS=true', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_TLS: 'true' });
    expect(lastCallArg()).toMatchObject({ socket: { tls: true } });
  });

  it('does not set socket.tls when REDIS_TLS is absent', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h' });
    const socket = lastCallArg()['socket'] as Record<string, unknown>;
    expect(socket).not.toHaveProperty('tls');
  });

  it('does not set socket.tls when REDIS_TLS is not "true"', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_TLS: 'false' });
    const socket = lastCallArg()['socket'] as Record<string, unknown>;
    expect(socket).not.toHaveProperty('tls');
  });

  it('applies REDIS_CONNECT_TIMEOUT_MS', () => {
    RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_CONNECT_TIMEOUT_MS: '2000' });
    expect(lastCallArg()).toMatchObject({ socket: { connectTimeout: 2_000 } });
  });

  it('rejects non-numeric REDIS_CONNECT_TIMEOUT_MS', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_CONNECT_TIMEOUT_MS: 'bad' }),
    ).toThrow('REDIS_CONNECT_TIMEOUT_MS must be a positive integer');
  });

  it('rejects non-positive REDIS_CONNECT_TIMEOUT_MS', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', REDIS_CONNECT_TIMEOUT_MS: '0' }),
    ).toThrow('REDIS_CONNECT_TIMEOUT_MS must be a positive integer');
  });

  it('applies LLM_CACHE_KEY_PREFIX as key namespace', () => {
    const b = RedisBackend.fromEnv({
      REDIS_URL: 'redis://h',
      LLM_CACHE_KEY_PREFIX: 'myapp',
    });
    expect(b).toBeInstanceOf(RedisBackend);
  });

  it('rejects invalid LLM_CACHE_TTL_MS', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', LLM_CACHE_TTL_MS: '-1' }),
    ).toThrow('LLM_CACHE_TTL_MS must be a positive integer');
  });

  it('rejects non-numeric LLM_CACHE_TTL_MS', () => {
    expect(() =>
      RedisBackend.fromEnv({ REDIS_URL: 'redis://h', LLM_CACHE_TTL_MS: 'inf' }),
    ).toThrow('LLM_CACHE_TTL_MS must be a positive integer');
  });

  it('accepts full multi-option env', () => {
    const b = RedisBackend.fromEnv({
      REDIS_URL: 'rediss://cache.internal:6380',
      REDIS_PASSWORD: 'secret',
      REDIS_USERNAME: 'admin',
      REDIS_DB: '2',
      REDIS_TLS: 'true',
      REDIS_CONNECT_TIMEOUT_MS: '3000',
      LLM_CACHE_KEY_PREFIX: 'prod',
      LLM_CACHE_TTL_MS: '86400000',
    });
    expect(b).toBeInstanceOf(RedisBackend);
    expect(lastCallArg()).toMatchObject({
      url: 'rediss://cache.internal:6380',
      password: 'secret',
      username: 'admin',
      database: 2,
      socket: { tls: true, connectTimeout: 3_000 },
    });
  });
});

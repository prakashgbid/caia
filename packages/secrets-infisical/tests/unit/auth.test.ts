import { describe, it, expect } from 'vitest';
import { InfisicalAuth } from '../../src/auth.js';
import {
  SecretProviderError,
  SecretsAdapterConfigError,
} from '@caia/secrets-adapter';
import { MockInfisicalServer } from './fetch-mock.js';

const baseUrl = 'https://infisical.test';

describe('InfisicalAuth — construction', () => {
  it('requires baseUrl', () => {
    expect(
      () =>
        new InfisicalAuth({
          baseUrl: '',
          auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
        }),
    ).toThrow(SecretsAdapterConfigError);
  });

  it('requires auth config', () => {
    expect(
      () =>
        new InfisicalAuth({
          baseUrl,
          // @ts-expect-error — runtime mistake
          auth: undefined,
        }),
    ).toThrow(SecretsAdapterConfigError);
  });

  it('rejects universal-auth without credentials', () => {
    expect(
      () =>
        new InfisicalAuth({
          baseUrl,
          auth: { type: 'universal-auth', clientId: '', clientSecret: 'b' },
        }),
    ).toThrow(SecretsAdapterConfigError);
  });

  it('rejects static-token without token', () => {
    expect(
      () =>
        new InfisicalAuth({
          baseUrl,
          auth: { type: 'static-token', accessToken: '' },
        }),
    ).toThrow(SecretsAdapterConfigError);
  });

  it('rejects unknown auth type', () => {
    expect(
      () =>
        new InfisicalAuth({
          baseUrl,
          // @ts-expect-error — invalid type
          auth: { type: 'oauth' },
        }),
    ).toThrow(SecretsAdapterConfigError);
  });
});

describe('InfisicalAuth — universal-auth login', () => {
  it('logs in once and caches', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
      fetchImpl: server.fetchImpl,
    });
    const h1 = await auth.authorizedHeaders();
    const h2 = await auth.authorizedHeaders();
    expect(h1['Authorization']).toBe('Bearer tok_1');
    expect(h2['Authorization']).toBe('Bearer tok_1');
    expect(server.loginCount).toBe(1);
  });

  it('re-logs in after invalidate', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
      fetchImpl: server.fetchImpl,
    });
    await auth.authorizedHeaders();
    auth.invalidate();
    const h = await auth.authorizedHeaders();
    expect(h['Authorization']).toBe('Bearer tok_2');
    expect(server.loginCount).toBe(2);
  });

  it('refreshes when nearing expiry', async () => {
    const server = new MockInfisicalServer();
    let now = 1_000_000;
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
      fetchImpl: server.fetchImpl,
      refreshSkewMs: 5 * 60 * 1000,
      now: () => now,
    });
    await auth.authorizedHeaders();
    // Token expiresIn=600s, skew=300s, so the cached token is reusable
    // until elapsed time crosses 300s. At t=250s the cache is still valid.
    now += 250_000;
    await auth.authorizedHeaders();
    expect(server.loginCount).toBe(1);
    // Advance to 350s — past the refresh threshold; expect a new login.
    now += 100_000;
    await auth.authorizedHeaders();
    expect(server.loginCount).toBe(2);
  });

  it('throws SecretProviderError on 401', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'BAD', clientSecret: 'b' },
      fetchImpl: server.fetchImpl,
    });
    await expect(auth.authorizedHeaders()).rejects.toBeInstanceOf(
      SecretProviderError,
    );
  });

  it('dedupes concurrent logins', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
      fetchImpl: server.fetchImpl,
    });
    const [a, b, c] = await Promise.all([
      auth.authorizedHeaders(),
      auth.authorizedHeaders(),
      auth.authorizedHeaders(),
    ]);
    expect(a['Authorization']).toBe(b['Authorization']);
    expect(b['Authorization']).toBe(c['Authorization']);
    expect(server.loginCount).toBe(1);
  });
});

describe('InfisicalAuth — static token', () => {
  it('uses the static token without contacting login', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'static-token', accessToken: 'preset-token' },
      fetchImpl: server.fetchImpl,
    });
    const h = await auth.authorizedHeaders();
    expect(h['Authorization']).toBe('Bearer preset-token');
    expect(server.loginCount).toBe(0);
  });
});

describe('InfisicalAuth — Cloudflare Access headers', () => {
  it('includes CF headers on every authorized call', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'static-token', accessToken: 't' },
      cloudflareAccess: { clientId: 'cf-id', clientSecret: 'cf-secret' },
      fetchImpl: server.fetchImpl,
    });
    const h = await auth.authorizedHeaders();
    expect(h['CF-Access-Client-Id']).toBe('cf-id');
    expect(h['CF-Access-Client-Secret']).toBe('cf-secret');
  });

  it('cloudflareAccessHeaders returns empty when not configured', () => {
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'static-token', accessToken: 't' },
    });
    expect(auth.cloudflareAccessHeaders()).toEqual({});
  });

  it('login includes CF headers', async () => {
    const server = new MockInfisicalServer();
    server.requireCfHeaders = true;
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
      cloudflareAccess: { clientId: 'cf-id', clientSecret: 'cf-secret' },
      fetchImpl: server.fetchImpl,
    });
    const h = await auth.authorizedHeaders();
    expect(h['Authorization']).toBe('Bearer tok_1');
  });
});

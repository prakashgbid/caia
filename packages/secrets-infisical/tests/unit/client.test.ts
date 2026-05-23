import { describe, it, expect } from 'vitest';
import { InfisicalClient } from '../../src/client.js';
import { InfisicalAuth } from '../../src/auth.js';
import {
  SecretNotFoundError,
  SecretPolicyDeniedError,
  SecretProviderError,
  SecretRateLimitedError,
} from '@caia/secrets-adapter';
import { MockInfisicalServer } from './fetch-mock.js';

const baseUrl = 'https://infisical.test';

function newClient(server: MockInfisicalServer): InfisicalClient {
  const auth = new InfisicalAuth({
    baseUrl,
    auth: { type: 'static-token', accessToken: 'tok_1' },
    fetchImpl: server.fetchImpl,
  });
  return new InfisicalClient({ baseUrl, auth, fetchImpl: server.fetchImpl });
}

describe('InfisicalClient — put + get round-trip', () => {
  it('put then get returns the value', async () => {
    const server = new MockInfisicalServer();
    const client = newClient(server);
    await client.putSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/cloud.aws',
      secretName: 'access_key',
      secretValue: 'AKIA-x',
    });
    const got = await client.getSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/cloud.aws',
      secretName: 'access_key',
    });
    expect(got.secretValue).toBe('AKIA-x');
    expect(got.secretKey).toBe('access_key');
    expect(got.version).toBe(1);
  });

  it('update bumps version', async () => {
    const server = new MockInfisicalServer();
    const client = newClient(server);
    await client.putSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'k',
      secretValue: 'v1',
    });
    const updated = await client.updateSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'k',
      secretValue: 'v2',
    });
    expect(updated.version).toBe(2);
    const got = await client.getSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'k',
    });
    expect(got.secretValue).toBe('v2');
  });

  it('delete is idempotent', async () => {
    const server = new MockInfisicalServer();
    const client = newClient(server);
    await client.putSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'k',
      secretValue: 'v',
    });
    await client.deleteSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'k',
    });
    await expect(
      client.deleteSecret({
        workspaceId: 'wsk-1',
        environment: 'prod',
        secretPath: '/c',
        secretName: 'k',
      }),
    ).resolves.toBeUndefined();
  });

  it('list returns secrets at a path', async () => {
    const server = new MockInfisicalServer();
    const client = newClient(server);
    await client.putSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'a',
      secretValue: 'va',
    });
    await client.putSecret({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'b',
      secretValue: 'vb',
    });
    const list = await client.listSecrets({
      workspaceId: 'wsk-1',
      environment: 'prod',
      secretPath: '/c',
    });
    expect(list).toHaveLength(2);
  });
});

describe('InfisicalClient — error mapping', () => {
  it('404 -> SecretNotFoundError', async () => {
    const server = new MockInfisicalServer();
    const client = newClient(server);
    await expect(
      client.getSecret({
        workspaceId: 'wsk-1',
        environment: 'prod',
        secretPath: '/c',
        secretName: 'missing',
      }),
    ).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('403 -> SecretPolicyDeniedError', async () => {
    const server = new MockInfisicalServer();
    server.failNext = { match: /\/api\/v3\/secrets\/raw\//, status: 403 };
    const client = newClient(server);
    await expect(
      client.putSecret({
        workspaceId: 'wsk-1',
        environment: 'prod',
        secretPath: '/c',
        secretName: 'k',
        secretValue: 'v',
      }),
    ).rejects.toBeInstanceOf(SecretPolicyDeniedError);
  });

  it('500 -> SecretProviderError', async () => {
    const server = new MockInfisicalServer();
    server.failNext = { match: /\/api\/v3\/secrets\/raw\//, status: 500 };
    const client = newClient(server);
    await expect(
      client.putSecret({
        workspaceId: 'wsk-1',
        environment: 'prod',
        secretPath: '/c',
        secretName: 'k',
        secretValue: 'v',
      }),
    ).rejects.toBeInstanceOf(SecretProviderError);
  });

  it('429 -> SecretRateLimitedError', async () => {
    const server = new MockInfisicalServer();
    const realFetch = server.fetchImpl;
    server.fetchImpl = async (input, init) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      if (url.includes('/api/v3/secrets/raw/')) {
        return new Response('rate', {
          status: 429,
          headers: { 'retry-after': '7' },
        });
      }
      return realFetch(input, init);
    };
    const client = newClient(server);
    await expect(
      client.getSecret({
        workspaceId: 'w',
        environment: 'prod',
        secretPath: '/c',
        secretName: 'k',
      }),
    ).rejects.toMatchObject({
      errorClass: 'rate_limited',
      retryAfterMs: 7000,
    });
    // Sanity: typed error class
    await expect(
      client.getSecret({
        workspaceId: 'w',
        environment: 'prod',
        secretPath: '/c',
        secretName: 'k',
      }),
    ).rejects.toBeInstanceOf(SecretRateLimitedError);
  });
});

describe('InfisicalClient — 401 auto-retry with re-login', () => {
  it('refreshes token on first 401 and retries', async () => {
    const server = new MockInfisicalServer();
    const auth = new InfisicalAuth({
      baseUrl,
      auth: { type: 'universal-auth', clientId: 'a', clientSecret: 'b' },
      fetchImpl: server.fetchImpl,
    });
    const client = new InfisicalClient({ baseUrl, auth, fetchImpl: server.fetchImpl });
    server.expiredOnFirstUse = true;
    await client.putSecret({
      workspaceId: 'w',
      environment: 'prod',
      secretPath: '/c',
      secretName: 'k',
      secretValue: 'v',
    });
    expect(server.loginCount).toBe(2);
  });
});

describe('InfisicalClient — health', () => {
  it('reports ok on /api/status 200', async () => {
    const server = new MockInfisicalServer();
    const client = newClient(server);
    const r = await client.health();
    expect(r.ok).toBe(true);
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });
});

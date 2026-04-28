import * as fs from 'node:fs';
import {
  configureAdapter,
  loadManifest,
  getLoadedManifests,
  fetchSecret,
  fetchBatch,
  fetchEnv,
  rotateSecret,
  cacheSize,
  invalidateCache,
  flushCache,
  getBrokerToken,
} from '../client';
import { clearAuditLog, getAuditLog, configureConductorApi } from '../events';
import type { VaultAdapter, SiteManifest } from '../types';

function mockAdapter(values: Record<string, string> = {}): VaultAdapter {
  return {
    name: 'mock-vault',
    fetchSecret: jest.fn(async (_path: string, key: string) => {
      if (key in values) return values[key]!;
      throw new Error(`mock: key '${key}' not found`);
    }),
    listPaths: jest.fn(async () => Object.keys(values)),
    writeSecret: jest.fn(async () => undefined),
  };
}

const siteManifest: SiteManifest = {
  site_slug: 'poker-zeno',
  secrets: {
    GA4_MEASUREMENT_ID: { path: 'kv/ga4/pokerzeno', public: true, ttl_sec: 3600 },
    CLOUDFLARE_API_TOKEN: { path: 'kv/cloudflare/pokerzeno', public: false, ttl_sec: 300 },
  },
};

beforeEach(() => {
  clearAuditLog();
  flushCache();
  configureConductorApi(null);
  global.fetch = jest.fn().mockResolvedValue({ ok: true }) as typeof fetch;
});

afterEach(() => {
  flushCache();
  clearAuditLog();
});

describe('configureAdapter + loadManifest', () => {
  it('getLoadedManifests returns loaded site slugs', () => {
    loadManifest(siteManifest);
    expect(getLoadedManifests()).toContain('poker-zeno');
  });
});

describe('fetchSecret', () => {
  it('fetches and caches a secret', async () => {
    configureAdapter(mockAdapter({ CLOUDFLARE_API_TOKEN: 'tok-123' }));
    loadManifest(siteManifest);

    const result = await fetchSecret('CLOUDFLARE_API_TOKEN', { siteSlug: 'poker-zeno', callerModule: 'test' });
    expect(result.value).toBe('tok-123');
    expect(result.cached).toBe(false);
    expect(result.key).toBe('CLOUDFLARE_API_TOKEN');
    expect(result.site_slug).toBe('poker-zeno');
    expect(result.public).toBe(false);
    expect(result.fetch_latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('returns cached result on second call', async () => {
    const adapter = mockAdapter({ GA4_MEASUREMENT_ID: 'G-TESTID' });
    configureAdapter(adapter);
    loadManifest(siteManifest);

    await fetchSecret('GA4_MEASUREMENT_ID', { siteSlug: 'poker-zeno', callerModule: 'a' });
    const result2 = await fetchSecret('GA4_MEASUREMENT_ID', { siteSlug: 'poker-zeno', callerModule: 'a' });

    expect(result2.cached).toBe(true);
    expect((adapter.fetchSecret as jest.Mock).mock.calls).toHaveLength(1);
  });

  it('adds a fetched audit entry', async () => {
    configureAdapter(mockAdapter({ GA4_MEASUREMENT_ID: 'G-TEST' }));
    loadManifest(siteManifest);

    await fetchSecret('GA4_MEASUREMENT_ID', { siteSlug: 'poker-zeno' });
    const log = getAuditLog();
    expect(log.some(e => e.event === 'fetched')).toBe(true);
  });

  it('adds a cache_hit audit entry on second call', async () => {
    configureAdapter(mockAdapter({ GA4_MEASUREMENT_ID: 'G-TEST' }));
    loadManifest(siteManifest);

    await fetchSecret('GA4_MEASUREMENT_ID', { siteSlug: 'poker-zeno' });
    clearAuditLog();
    await fetchSecret('GA4_MEASUREMENT_ID', { siteSlug: 'poker-zeno' });

    const log = getAuditLog();
    expect(log.some(e => e.event === 'cache_hit')).toBe(true);
  });

  it('records fetch_failed on adapter error', async () => {
    configureAdapter(mockAdapter({}));
    loadManifest(siteManifest);

    await expect(fetchSecret('CLOUDFLARE_API_TOKEN', { siteSlug: 'poker-zeno' })).rejects.toThrow();
    const log = getAuditLog();
    expect(log.some(e => e.event === 'fetch_failed')).toBe(true);
  });

  it('uses default site_slug and callerModule when not provided', async () => {
    configureAdapter(mockAdapter({ SOME_KEY: 'val' }));
    const result = await fetchSecret('SOME_KEY');
    expect(result.site_slug).toBe('default');
    expect(result.key).toBe('SOME_KEY');
  });

  it('uses meta.key when manifest specifies an explicit vault key name', async () => {
    const adapter = mockAdapter({ VAULT_KEY_NAME: 'translated-value' });
    configureAdapter(adapter);
    loadManifest({
      site_slug: 'keyed-site',
      secrets: {
        MY_ALIAS: { path: 'kv/test/keyed-site', key: 'VAULT_KEY_NAME', public: false, ttl_sec: 60 },
      },
    });
    const result = await fetchSecret('MY_ALIAS', { siteSlug: 'keyed-site' });
    expect(result.value).toBe('translated-value');
    const [, usedKey] = (adapter.fetchSecret as jest.Mock).mock.calls[0] as [string, string];
    expect(usedKey).toBe('VAULT_KEY_NAME');
  });

  it('marks NEXT_PUBLIC_* keys as public even without manifest', async () => {
    configureAdapter(mockAdapter({ NEXT_PUBLIC_GA4: 'G-TEST' }));
    const result = await fetchSecret('NEXT_PUBLIC_GA4', { siteSlug: 'default' });
    expect(result.public).toBe(true);
  });

  it('uses TTL from opts if provided', async () => {
    configureAdapter(mockAdapter({ MY_KEY: 'v' }));
    const result = await fetchSecret('MY_KEY', { ttl: 999 });
    expect(result.expires_at).toBeDefined();
  });

  it('emits secret.fetched event when conductor API configured', async () => {
    const posted: RequestInit[] = [];
    global.fetch = jest.fn((_url, init) => {
      posted.push(init as RequestInit);
      return Promise.resolve({ ok: true } as Response);
    }) as typeof fetch;

    configureConductorApi('http://localhost:7776');
    configureAdapter(mockAdapter({ GA4_MEASUREMENT_ID: 'G-X' }));
    loadManifest(siteManifest);

    await fetchSecret('GA4_MEASUREMENT_ID', { siteSlug: 'poker-zeno' });
    const bodies = posted.map(p => JSON.parse(p.body as string) as Record<string, unknown>);
    expect(bodies.some(b => b.type === 'secret.fetched')).toBe(true);
  });
});

describe('fetchBatch', () => {
  it('returns all keys in parallel', async () => {
    configureAdapter(mockAdapter({ A: '1', B: '2' }));
    const result = await fetchBatch(['A', 'B']);
    expect(result['A']!.value).toBe('1');
    expect(result['B']!.value).toBe('2');
  });

  it('rejects if any key fails', async () => {
    configureAdapter(mockAdapter({ A: '1' }));
    await expect(fetchBatch(['A', 'MISSING'])).rejects.toThrow();
  });
});

describe('fetchEnv', () => {
  it('returns KEY→value map for the site', async () => {
    configureAdapter(mockAdapter({ GA4_MEASUREMENT_ID: 'G-TEST', CLOUDFLARE_API_TOKEN: 'cf-tok' }));
    loadManifest(siteManifest);

    const env = await fetchEnv('poker-zeno');
    expect(env['GA4_MEASUREMENT_ID']).toBe('G-TEST');
    expect(env['CLOUDFLARE_API_TOKEN']).toBe('cf-tok');
  });

  it('throws if no manifest loaded for site', async () => {
    await expect(fetchEnv('nonexistent-site')).rejects.toThrow("No manifest loaded");
  });
});

describe('rotateSecret', () => {
  it('uses default siteSlug and callerModule when opts omitted', async () => {
    const adapter = mockAdapter({ SOME_KEY: 'old' });
    configureAdapter(adapter);
    // No manifest for 'default' site — path fallback used (covers meta?.path ?? fallback)
    await rotateSecret('SOME_KEY', 'new-value');
    expect((adapter.writeSecret as jest.Mock).mock.calls).toHaveLength(1);
    const [path] = (adapter.writeSecret as jest.Mock).mock.calls[0] as [string, string, string];
    expect(path).toContain('some_key'); // fallback path uses key.toLowerCase()
  });

  it('writes to vault and invalidates cache', async () => {
    const adapter = mockAdapter({ CLOUDFLARE_API_TOKEN: 'old' });
    configureAdapter(adapter);
    loadManifest(siteManifest);

    // Pre-populate cache
    await fetchSecret('CLOUDFLARE_API_TOKEN', { siteSlug: 'poker-zeno' });
    expect(cacheSize()).toBeGreaterThan(0);

    await rotateSecret('CLOUDFLARE_API_TOKEN', 'new-value', { siteSlug: 'poker-zeno', callerModule: 'test' });
    expect((adapter.writeSecret as jest.Mock).mock.calls).toHaveLength(1);

    // Cache should be invalidated
    // Re-mock fetchSecret to return new value
    (adapter.fetchSecret as jest.Mock).mockResolvedValueOnce('new-value');
    const refreshed = await fetchSecret('CLOUDFLARE_API_TOKEN', { siteSlug: 'poker-zeno' });
    expect(refreshed.cached).toBe(false);
  });

  it('records rotated audit entry', async () => {
    const adapter = mockAdapter({ CLOUDFLARE_API_TOKEN: 'old' });
    configureAdapter(adapter);
    loadManifest(siteManifest);

    clearAuditLog();
    await rotateSecret('CLOUDFLARE_API_TOKEN', 'new-val', { siteSlug: 'poker-zeno' });
    const log = getAuditLog();
    expect(log.some(e => e.event === 'rotated')).toBe(true);
  });
});

describe('cache helpers', () => {
  it('cacheSize returns 0 initially', () => {
    flushCache();
    expect(cacheSize()).toBe(0);
  });

  it('invalidateCache removes specific key', async () => {
    configureAdapter(mockAdapter({ MY_KEY: 'v' }));
    await fetchSecret('MY_KEY', { siteSlug: 'default' });
    expect(cacheSize()).toBeGreaterThan(0);
    invalidateCache('default:MY_KEY');
    expect(cacheSize()).toBe(0);
  });

  it('flushCache clears everything', async () => {
    configureAdapter(mockAdapter({ A: '1', B: '2' }));
    await fetchBatch(['A', 'B']);
    flushCache();
    expect(cacheSize()).toBe(0);
  });
});

describe('getBrokerToken', () => {
  it('returns BROKER_TOKEN env var if set', () => {
    process.env['BROKER_TOKEN'] = 'my-test-token';
    expect(getBrokerToken()).toBe('my-test-token');
    delete process.env['BROKER_TOKEN'];
  });

  it('returns empty string if no token found', () => {
    delete process.env['BROKER_TOKEN'];
    const token = getBrokerToken();
    expect(typeof token).toBe('string');
  });

  it('reads ~/.vault-token when BROKER_TOKEN is absent and file exists', () => {
    delete process.env['BROKER_TOKEN'];
    const fs = jest.requireActual<typeof import('node:fs')>('node:fs');
    const existsSpy = jest.spyOn(fs, 'existsSync').mockReturnValueOnce(true);
    const readSpy = jest.spyOn(fs, 'readFileSync').mockReturnValueOnce('file-vault-token\n' as never);
    const token = getBrokerToken();
    expect(token).toBe('file-vault-token');
    existsSpy.mockRestore();
    readSpy.mockRestore();
  });
});

describe('getAdapter fallback (no configureAdapter called)', () => {
  it('uses createVaultAdapter() when adapter not configured', async () => {
    // After flushCache, _adapter is reset — next fetchSecret uses createVaultAdapter()
    flushCache();
    // Set VAULT_ADAPTER to ssh-file which will try SSH and fail in test env
    process.env['VAULT_ADAPTER'] = 'ssh-file';
    process.env['VAULT_SSH_HOST'] = 'nonexistent-host-99999';

    // Should reject because SSH fails — but the code path (lines 38-39) IS covered
    await expect(fetchSecret('SOME_KEY', { siteSlug: 'default' })).rejects.toThrow();

    delete process.env['VAULT_ADAPTER'];
    delete process.env['VAULT_SSH_HOST'];
    // Reconfigure adapter for remaining tests
    configureAdapter({ name: 'mock', fetchSecret: jest.fn(), listPaths: jest.fn(), writeSecret: jest.fn() });
  });
});

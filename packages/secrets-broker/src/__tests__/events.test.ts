import {
  hashKey,
  recordAudit,
  getAuditLog,
  clearAuditLog,
  configureConductorApi,
  getConductorApi,
  emitEvent,
} from '../events';
import type { AuditEntry } from '../types';

const makeEntry = (overrides: Partial<AuditEntry> = {}): AuditEntry => ({
  timestamp: new Date().toISOString(),
  actor: 'secrets-broker',
  secret_key_hash: 'abc123',
  caller_module: 'test',
  site_slug: 'poker-zeno',
  event: 'fetched',
  cached: false,
  ...overrides,
});

describe('hashKey', () => {
  it('returns a 16-char hex string', () => {
    const h = hashKey('GA4_MEASUREMENT_ID');
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(hashKey('SOME_KEY')).toBe(hashKey('SOME_KEY'));
  });

  it('differs for different keys', () => {
    expect(hashKey('KEY_A')).not.toBe(hashKey('KEY_B'));
  });
});

describe('audit log', () => {
  beforeEach(() => clearAuditLog());

  it('records entries', () => {
    recordAudit(makeEntry());
    expect(getAuditLog()).toHaveLength(1);
  });

  it('returns immutable copy', () => {
    recordAudit(makeEntry());
    const log = getAuditLog();
    (log as AuditEntry[]).push(makeEntry());
    expect(getAuditLog()).toHaveLength(1);
  });

  it('caps at 100 entries (FIFO eviction)', () => {
    for (let i = 0; i < 105; i++) recordAudit(makeEntry({ caller_module: `mod-${i}` }));
    const log = getAuditLog();
    expect(log).toHaveLength(100);
    // Oldest 5 should have been evicted
    expect(log[0]!.caller_module).toBe('mod-5');
  });

  it('clearAuditLog empties the log', () => {
    recordAudit(makeEntry());
    clearAuditLog();
    expect(getAuditLog()).toHaveLength(0);
  });
});

describe('configureConductorApi', () => {
  afterEach(() => configureConductorApi(null));

  it('stores and returns the API URL', () => {
    configureConductorApi('http://localhost:7776');
    expect(getConductorApi()).toBe('http://localhost:7776');
  });

  it('accepts null to disable', () => {
    configureConductorApi('http://x');
    configureConductorApi(null);
    expect(getConductorApi()).toBeNull();
  });
});

describe('emitEvent', () => {
  afterEach(() => configureConductorApi(null));

  it('is a no-op when conductor API is not configured', async () => {
    configureConductorApi(null);
    await expect(emitEvent('secret.fetched', {})).resolves.toBeUndefined();
  });

  it('sends a POST when conductor API is configured', async () => {
    const fetched: RequestInit[] = [];
    global.fetch = jest.fn((_url, init) => {
      fetched.push(init as RequestInit);
      return Promise.resolve({ ok: true } as Response);
    }) as typeof fetch;

    configureConductorApi('http://localhost:7776');
    await emitEvent('secret.fetched', { secret_key_hash: 'abc' });
    expect(fetched).toHaveLength(1);
    const body = JSON.parse(fetched[0]!.body as string) as Record<string, unknown>;
    expect(body.type).toBe('secret.fetched');
    expect(body.actor).toBe('secrets-broker');
  });

  it('silently swallows fetch errors (best-effort)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    configureConductorApi('http://localhost:7776');
    await expect(emitEvent('secret.fetched', {})).resolves.toBeUndefined();
  });

  it('uses provided severity', async () => {
    const fetched: RequestInit[] = [];
    global.fetch = jest.fn((_url, init) => {
      fetched.push(init as RequestInit);
      return Promise.resolve({ ok: true } as Response);
    }) as typeof fetch;

    configureConductorApi('http://localhost:7776');
    await emitEvent('secret.access_denied', {}, 'warning');
    const body = JSON.parse(fetched[0]!.body as string) as Record<string, unknown>;
    expect(body.severity).toBe('warning');
  });
});

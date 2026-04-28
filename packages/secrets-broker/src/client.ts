import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { TtlCache } from './cache.js';
import { hashKey, recordAudit, emitEvent } from './events.js';
import { createVaultAdapter } from './vault-adapter.js';
import type { VaultAdapter, SiteManifest, SecretValue, BrokerOptions } from './types.js';

const DEFAULT_TTL_SEC = 300;

const log = pino({
  name: 'secrets-broker',
  level: process.env['BROKER_LOG_LEVEL'] ?? 'info',
  redact: { paths: ['value', '*.value', 'secret', '*.secret'], censor: '[REDACTED]' },
});

const cache = new TtlCache<SecretValue>();
const manifestCache = new TtlCache<SiteManifest>();

let _adapter: VaultAdapter | null = null;
let _manifests: Map<string, SiteManifest> = new Map();

export function configureAdapter(adapter: VaultAdapter): void {
  _adapter = adapter;
}

export function loadManifest(manifest: SiteManifest): void {
  _manifests.set(manifest.site_slug, manifest);
}

export function getLoadedManifests(): string[] {
  return [..._manifests.keys()];
}

function getAdapter(): VaultAdapter {
  if (_adapter) return _adapter;
  _adapter = createVaultAdapter();
  return _adapter;
}

function readBrokerToken(): string {
  const envToken = process.env['BROKER_TOKEN'];
  if (envToken) return envToken;
  const tokenFile = join(homedir(), '.vault-token');
  if (existsSync(tokenFile)) return readFileSync(tokenFile, 'utf8').trim();
  return '';
}

export function getBrokerToken(): string {
  return readBrokerToken();
}

function resolveManifestEntry(siteSlug: string, key: string) {
  const manifest = _manifests.get(siteSlug);
  return manifest?.secrets[key] ?? null;
}

/** @no-events Cache-size accessor — no side effects */
export function cacheSize(): number {
  return cache.size();
}

/** @no-events Invalidate a single cached secret */
export function invalidateCache(cacheKey: string): void {
  cache.delete(cacheKey);
}

/** @no-events Flush entire in-process cache and reset adapter for testing */
export function flushCache(): void {
  cache.clear();
  manifestCache.clear();
  _adapter = null;
  _manifests = new Map();
}

export async function fetchSecret(
  key: string,
  opts: BrokerOptions = {},
): Promise<SecretValue> {
  const siteSlug = opts.siteSlug ?? 'default';
  const callerModule = opts.callerModule ?? 'unknown';
  const cacheKey = `${siteSlug}:${key}`;
  const keyHash = hashKey(key);

  const cached = cache.get(cacheKey);
  if (cached) {
    log.debug({ secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug },
      'secret cache hit');
    recordAudit({ timestamp: new Date().toISOString(), actor: 'secrets-broker',
      secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
      event: 'cache_hit', cached: true });
    await emitEvent('secret.cache_hit', {
      secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
      ttl_remaining_sec: cache.ttlRemainingSeconds(cacheKey),
    }, 'debug');
    return { ...cached, cached: true };
  }

  const meta = resolveManifestEntry(siteSlug, key);
  const path = meta?.path ?? `kv/${siteSlug}/${key.toLowerCase()}`;
  const ttlSec = opts.ttl ?? meta?.ttl_sec ?? DEFAULT_TTL_SEC;
  const isPublic = meta?.public ?? key.startsWith('NEXT_PUBLIC_');

  const start = Date.now();
  let rawValue: string;
  try {
    rawValue = await getAdapter().fetchSecret(path, meta?.key ?? key);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    log.error({ secret_key_hash: keyHash, caller_module: callerModule, error }, 'secret fetch failed');
    recordAudit({ timestamp: new Date().toISOString(), actor: 'secrets-broker',
      secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
      event: 'fetch_failed', cached: false });
    await emitEvent('secret.fetch_failed', { secret_key_hash: keyHash, caller_module: callerModule, error }, 'error');
    throw err;
  }

  const fetchLatencyMs = Date.now() - start;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSec * 1000);

  const result: SecretValue = {
    value: rawValue,
    key,
    site_slug: siteSlug,
    public: isPublic,
    fetched_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    cached: false,
    fetch_latency_ms: fetchLatencyMs,
  };

  cache.set(cacheKey, result, ttlSec);
  log.info({ secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
    ttl_sec: ttlSec, fetch_latency_ms: fetchLatencyMs }, 'secret fetched');
  recordAudit({ timestamp: now.toISOString(), actor: 'secrets-broker',
    secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
    event: 'fetched', cached: false });
  await emitEvent('secret.fetched', {
    secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
    ttl_sec: ttlSec, cached: false,
  });

  return result;
}

export async function fetchBatch(
  keys: string[],
  opts: BrokerOptions = {},
): Promise<Record<string, SecretValue>> {
  const results = await Promise.all(keys.map(k => fetchSecret(k, opts)));
  return Object.fromEntries(results.map((r, i) => [keys[i]!, r]));
}

export async function fetchEnv(
  siteSlug: string,
  opts: Omit<BrokerOptions, 'siteSlug'> = {},
): Promise<Record<string, string>> {
  const manifest = _manifests.get(siteSlug);
  if (!manifest) throw new Error(`No manifest loaded for site '${siteSlug}'`);
  const keys = Object.keys(manifest.secrets);
  const batch = await fetchBatch(keys, { ...opts, siteSlug });
  return Object.fromEntries(Object.entries(batch).map(([k, v]) => [k, v.value]));
}

export async function rotateSecret(
  key: string,
  newValue: string,
  opts: BrokerOptions = {},
): Promise<void> {
  const siteSlug = opts.siteSlug ?? 'default';
  const callerModule = opts.callerModule ?? 'unknown';
  const keyHash = hashKey(key);
  const meta = resolveManifestEntry(siteSlug, key);
  const path = meta?.path ?? `kv/${siteSlug}/${key.toLowerCase()}`;

  log.info({ secret_key_hash: keyHash, site_slug: siteSlug, caller_module: callerModule },
    'rotation triggered');
  recordAudit({ timestamp: new Date().toISOString(), actor: 'secrets-broker',
    secret_key_hash: keyHash, caller_module: callerModule, site_slug: siteSlug,
    event: 'rotated', cached: false });
  await emitEvent('secret.rotation_triggered', {
    secret_key_hash: keyHash, site_slug: siteSlug, triggered_by: callerModule,
  });

  const start = Date.now();
  await getAdapter().writeSecret(path, meta?.key ?? key, newValue);
  const cacheKey = `${siteSlug}:${key}`;
  cache.delete(cacheKey);

  await emitEvent('secret.rotated', {
    secret_key_hash: keyHash, site_slug: siteSlug, duration_ms: Date.now() - start,
  });
  log.info({ secret_key_hash: keyHash, site_slug: siteSlug, duration_ms: Date.now() - start },
    'secret rotated');
}

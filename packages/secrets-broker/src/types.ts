export interface SecretMetadata {
  /** Vault path, e.g. "kv/ga4/pokerzeno" */
  path: string;
  /** Key name inside the vault file/path */
  key?: string;
  /** True → may appear in client bundle (NEXT_PUBLIC_*). Broker still serves it but marks it safe for logs. */
  public: boolean;
  /** Per-secret TTL override in seconds */
  ttl_sec: number;
}

export interface SiteManifest {
  site_slug: string;
  secrets: Record<string, SecretMetadata>;
}

export interface SecretValue {
  value: string;
  key: string;
  site_slug: string;
  public: boolean;
  fetched_at: string;
  expires_at: string;
  /** True when returned from in-process cache */
  cached: boolean;
  fetch_latency_ms: number;
}

export interface BrokerOptions {
  /** TTL override in seconds (default from manifest or 300) */
  ttl?: number;
  /** Logical caller identifier for audit log */
  callerModule?: string;
  /** Site slug for manifest lookup */
  siteSlug?: string;
}

export interface AuditEntry {
  timestamp: string;
  actor: string;
  secret_key_hash: string;
  caller_module: string;
  site_slug: string;
  event: 'fetched' | 'cache_hit' | 'access_denied' | 'rotated' | 'fetch_failed';
  cached: boolean;
}

export interface VaultAdapter {
  readonly name: string;
  fetchSecret(path: string, key: string): Promise<string>;
  listPaths(pathPrefix: string): Promise<string[]>;
  writeSecret(path: string, key: string, value: string): Promise<void>;
}

export interface RateLimitEntry {
  count: number;
  resetAt: number;
}

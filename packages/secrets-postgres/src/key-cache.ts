/**
 * In-memory LRU cache of per-tenant derived keys.
 *
 * Two reasons it exists:
 *
 *   1. HKDF is cheap but not free. Caching for the lifetime of a hot
 *      request batch keeps p99 latency tight.
 *   2. The cache is the **crypto-shred substrate** — `invalidate(tenantId)`
 *      forgets the derived key for that tenant. Combined with refusing to
 *      ever re-derive (the shred-tombstone check in the adapter), this is
 *      what makes GDPR right-to-erasure cryptographic rather than just
 *      DB-row-delete.
 *
 * Default LRU: 1024 entries, 5-minute TTL.
 */

export interface KeyCacheOptions {
  /** Max distinct tenants kept in cache. */
  maxEntries?: number;
  /** Per-entry TTL in milliseconds. */
  ttlMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

interface Entry {
  key: Buffer;
  expiresAt: number;
}

export class TenantKeyCache {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly map = new Map<string, Entry>();

  constructor(opts: KeyCacheOptions = {}) {
    this.maxEntries = opts.maxEntries ?? 1024;
    this.ttlMs = opts.ttlMs ?? 5 * 60 * 1000;
    this.now = opts.now ?? ((): number => Date.now());
  }

  get(tenantId: string): Buffer | undefined {
    const entry = this.map.get(tenantId);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      // Expired — drop the buffer, return undefined so the caller
      // re-derives.
      entry.key.fill(0);
      this.map.delete(tenantId);
      return undefined;
    }
    // LRU: move to end on access.
    this.map.delete(tenantId);
    this.map.set(tenantId, entry);
    return entry.key;
  }

  set(tenantId: string, key: Buffer): void {
    if (this.map.has(tenantId)) {
      const old = this.map.get(tenantId);
      if (old) old.key.fill(0);
      this.map.delete(tenantId);
    }
    while (this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (!oldest) break;
      const old = this.map.get(oldest);
      if (old) old.key.fill(0);
      this.map.delete(oldest);
    }
    this.map.set(tenantId, {
      key: Buffer.from(key),
      expiresAt: this.now() + this.ttlMs,
    });
  }

  /**
   * Forget a tenant's key. Used by crypto-shred. The Buffer is zeroed
   * before drop so the memory page no longer holds the key material.
   */
  invalidate(tenantId: string): boolean {
    const entry = this.map.get(tenantId);
    if (!entry) return false;
    entry.key.fill(0);
    this.map.delete(tenantId);
    return true;
  }

  /** Test-only: count entries. */
  get size(): number {
    return this.map.size;
  }

  /** Test-only: drop everything. */
  clear(): void {
    for (const entry of this.map.values()) entry.key.fill(0);
    this.map.clear();
  }
}

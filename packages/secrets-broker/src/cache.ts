interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  set(key: string, value: T, ttlSeconds: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  ttlRemainingSeconds(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return 0;
    return Math.max(0, Math.floor((entry.expiresAt - Date.now()) / 1000));
  }

  expiresAt(key: string): number {
    return this.store.get(key)?.expiresAt ?? 0;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    // Evict expired entries before counting
    for (const [k] of this.store) this.has(k);
    return this.store.size;
  }
}

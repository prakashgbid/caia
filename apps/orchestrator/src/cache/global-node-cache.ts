import { NodeCacheAdapter } from '@chiefaia/cache';
import type { CacheStats } from '@chiefaia/cache';

// Orchestrator-level in-memory cache singleton.
// Exposed via GET /node-cache/stats and POST /node-cache/reset.
let _instance: NodeCacheAdapter | null = null;

export function getGlobalNodeCache(): NodeCacheAdapter {
  if (!_instance) {
    _instance = new NodeCacheAdapter({
      keyPrefix: process.env['NODE_CACHE_KEY_PREFIX'] ?? 'caia',
      defaultTtlMs: parseInt(process.env['NODE_CACHE_TTL_MS'] ?? '3600000', 10),
      maxKeys: process.env['NODE_CACHE_MAX_KEYS']
        ? parseInt(process.env['NODE_CACHE_MAX_KEYS'], 10)
        : undefined,
      checkPeriodMs: 10 * 60 * 1000,
    });
  }
  return _instance;
}

export function getNodeCacheStats(): CacheStats {
  return getGlobalNodeCache().stats();
}

export function resetNodeCacheStats(): void {
  getGlobalNodeCache().resetStats();
}

export function listNodeCacheKeys(): string[] {
  return getGlobalNodeCache().keys();
}

export function getNodeCacheTtlMs(key: string): number | undefined {
  return getGlobalNodeCache().ttlMs(key);
}

export async function flushNodeCache(): Promise<void> {
  return getGlobalNodeCache().flush();
}

export async function deleteNodeCacheKey(key: string): Promise<void> {
  return getGlobalNodeCache().del(key);
}

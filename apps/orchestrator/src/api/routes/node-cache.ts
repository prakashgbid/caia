import type { Hono } from 'hono';
import {
  getNodeCacheStats,
  resetNodeCacheStats,
  listNodeCacheKeys,
  getNodeCacheTtlMs,
  flushNodeCache,
  deleteNodeCacheKey,
} from '../../cache/global-node-cache.js';

export function registerNodeCacheRoutes(app: Hono): void {
  // GET /node-cache/stats — return hit/miss/set/delete counters
  app.get('/node-cache/stats', (c) => {
    const stats = getNodeCacheStats();
    const total = stats.hits + stats.misses;
    const hitRatio = total > 0 ? Math.round((stats.hits / total) * 1000) / 10 : null;
    return c.json({ ...stats, hitRatioPct: hitRatio });
  });

  // POST /node-cache/reset — zero all counters (does not flush entries)
  app.post('/node-cache/reset', (c) => {
    resetNodeCacheStats();
    return c.json({ ok: true });
  });

  // GET /node-cache/keys — list all stored keys with TTL info
  app.get('/node-cache/keys', (c) => {
    const pattern = (c.req.query('pattern') ?? '').slice(0, 100);
    const keys = listNodeCacheKeys();
    const filtered = pattern ? keys.filter((k) => k.includes(pattern)) : keys;
    const now = Date.now();
    const entries = filtered.map((key) => {
      const expiresAt = getNodeCacheTtlMs(key);
      // ttlMs < 0 means expired-but-not-yet-evicted; null means no TTL
      const ttlMs = expiresAt !== undefined ? expiresAt - now : null;
      return { key, expiresAt: expiresAt ?? null, ttlMs };
    });
    return c.json({ count: entries.length, keys: entries });
  });

  // DELETE /node-cache/key/:key — remove a single entry
  app.delete('/node-cache/key/:key', async (c) => {
    const key = decodeURIComponent(c.req.param('key'));
    await deleteNodeCacheKey(key);
    return c.json({ ok: true, key });
  });

  // POST /node-cache/flush — remove all entries (does not reset stats counters)
  app.post('/node-cache/flush', async (c) => {
    await flushNodeCache();
    return c.json({ ok: true });
  });
}

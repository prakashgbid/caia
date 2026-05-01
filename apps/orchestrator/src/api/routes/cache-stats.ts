// CACHE-001 — Cache monitoring endpoint.
//
// Provides a unified cache health snapshot combining:
//   - LLM prompt-cache metrics (hits, misses, hit-rate) from the
//     in-memory llmMetrics tracker (shared with /llm/metrics)
//   - Active Redis configuration summary (host, port, prefix, TTL)
//   - Node-cache (in-memory) hit/miss/set/delete counters
//
// The dashboard's /cache page polls this endpoint every 5 s.

import type { Hono } from 'hono';
import { llmMetrics } from '@chiefaia/local-llm-router';
import type { Db } from '../../db/connection';
import { getRedisCacheOptionsStore } from '../../cache/redis-options';
import { getNodeCacheStats, resetNodeCacheStats } from '../../cache/global-node-cache.js';

export function registerCacheStatsRoutes(app: Hono, db: Db): void {
  app.get('/cache/stats', (c) => {
    const snapshot = llmMetrics.snapshot();
    const store = getRedisCacheOptionsStore(db);
    const globalConfigs = store.listActive('global');
    const globalConfig = globalConfigs[0] ?? null;

    const ncStats = getNodeCacheStats();
    const ncTotal = ncStats.hits + ncStats.misses;
    const ncHitRatioPct = ncTotal > 0 ? Math.round((ncStats.hits / ncTotal) * 1000) / 10 : null;

    return c.json({
      llmCache: {
        totalCalls: snapshot.totalCalls,
        cacheHits: snapshot.cacheHits,
        cacheMisses: snapshot.totalCalls - snapshot.cacheHits,
        cacheHitRate: snapshot.cacheHitRate,
        localCalls: snapshot.localCalls,
        claudeCalls: snapshot.claudeCalls,
        avgDurationMs: snapshot.avgDurationMs,
        savedUsd: snapshot.savedUsd,
      },
      redis: globalConfig
        ? {
            host: globalConfig.host,
            port: globalConfig.port,
            dbIndex: globalConfig.dbIndex,
            keyPrefix: globalConfig.keyPrefix,
            ttlSeconds: globalConfig.ttlSeconds,
            maxEntries: globalConfig.maxEntries,
            enabled: globalConfig.enabled,
            scope: globalConfig.scope,
          }
        : null,
      nodeCache: {
        hits: ncStats.hits,
        misses: ncStats.misses,
        sets: ncStats.sets,
        deletes: ncStats.deletes,
        hitRatioPct: ncHitRatioPct,
      },
    });
  });

  // POST /node-cache/reset — zero counters without flushing stored entries
  app.post('/node-cache/reset', (c) => {
    resetNodeCacheStats();
    return c.json({ ok: true });
  });
}

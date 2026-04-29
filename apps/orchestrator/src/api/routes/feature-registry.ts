/**
 * /api/feature-registry — FREG-007 dashboard backend.
 *
 * Five surfaces consumed by the dashboard's /registry page:
 *
 *   GET  /api/feature-registry/summary
 *     → registrySize, classificationCounts, recentlyAddedCount, projectBreakdown
 *
 *   GET  /api/feature-registry/recent?limit=N&project=...
 *     → most recently shipped/upserted registry rows (default 20)
 *
 *   GET  /api/feature-registry/search-log?limit=N
 *     → most recent registry.search() invocations (FREG-005's telemetry)
 *
 *   GET  /api/feature-registry/latency?windowHours=24
 *     → p50/p95/p99 latency from the search log (FREG-005's telemetry)
 *
 *   GET  /api/feature-registry/top-matches?windowHours=24&limit=10
 *     → most-frequently-matched feature_ids over the window
 */

import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import {
  featureRegistry,
  featureRegistrySearchLog,
} from '../../db/schema';

// @no-events — observability route surfaces, no domain mutations
export function registerFeatureRegistryRoutes(app: Hono, db: Db): void {
  app.get('/api/feature-registry/summary', (c) => {
    // Total rows
    const totalRow = db.all(
      sql`SELECT COUNT(*) AS c FROM feature_registry`,
    ) as Array<{ c: number }>;
    const total = totalRow[0]?.c ?? 0;

    // By project
    const byProject = db.all(
      sql`SELECT project, COUNT(*) AS c FROM feature_registry GROUP BY project ORDER BY c DESC`,
    ) as Array<{ project: string; c: number }>;

    // By source
    const bySource = db.all(
      sql`SELECT source, COUNT(*) AS c FROM feature_registry GROUP BY source ORDER BY c DESC`,
    ) as Array<{ source: string; c: number }>;

    // Classification counts from the search log over the last 24h
    const since24h = Date.now() - 24 * 60 * 60 * 1000;
    const classCounts = db.all(
      sql`SELECT classification, COUNT(*) AS c
          FROM feature_registry_search_log
          WHERE created_at >= ${since24h}
          GROUP BY classification`,
    ) as Array<{ classification: string; c: number }>;

    // Recent additions count (last 7 days)
    const since7d = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentlyAddedRow = db.all(
      sql`SELECT COUNT(*) AS c FROM feature_registry WHERE created_at >= ${since7d}`,
    ) as Array<{ c: number }>;
    const recentlyAddedCount = recentlyAddedRow[0]?.c ?? 0;

    return c.json({
      registrySize: total,
      projectBreakdown: byProject,
      sourceBreakdown: bySource,
      classificationCounts24h: classCounts,
      recentlyAddedCount,
    });
  });

  app.get('/api/feature-registry/recent', (c) => {
    const limitRaw = c.req.query('limit');
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '20', 10) || 20, 1), 200);
    const project = c.req.query('project') ?? undefined;

    const rows = project
      ? (db.all(sql`
          SELECT id, project, name, description, route_path, agent_name, source,
                 created_at, updated_at, story_id, embedding_model
          FROM feature_registry
          WHERE project = ${project}
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `) as Array<unknown>)
      : (db.all(sql`
          SELECT id, project, name, description, route_path, agent_name, source,
                 created_at, updated_at, story_id, embedding_model
          FROM feature_registry
          ORDER BY updated_at DESC
          LIMIT ${limit}
        `) as Array<unknown>);

    return c.json({ rows });
  });

  app.get('/api/feature-registry/search-log', (c) => {
    const limitRaw = c.req.query('limit');
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '50', 10) || 50, 1), 500);

    const rows = db.all(sql`
      SELECT id, query, project, classification, top_match_id, top_score,
             threshold_used, latency_ms, embedder_tokens, hit_count,
             caller, created_at
      FROM feature_registry_search_log
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as Array<unknown>;

    return c.json({ rows });
  });

  app.get('/api/feature-registry/latency', (c) => {
    const windowHoursRaw = c.req.query('windowHours');
    const windowHours = Math.min(
      Math.max(parseFloat(windowHoursRaw ?? '24') || 24, 0.1),
      24 * 30,
    );
    const since = Date.now() - windowHours * 60 * 60 * 1000;

    const latencies = db.all(sql`
      SELECT latency_ms FROM feature_registry_search_log
      WHERE created_at >= ${since}
      ORDER BY latency_ms ASC
    `) as Array<{ latency_ms: number }>;

    const sorted = latencies.map((r) => r.latency_ms);
    const n = sorted.length;
    if (n === 0) {
      return c.json({
        windowHours,
        sampleCount: 0,
        p50Ms: null,
        p95Ms: null,
        p99Ms: null,
        meanMs: null,
        maxMs: null,
      });
    }
    const pct = (p: number) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))]!;
    const mean = sorted.reduce((a, b) => a + b, 0) / n;

    return c.json({
      windowHours,
      sampleCount: n,
      p50Ms: pct(50),
      p95Ms: pct(95),
      p99Ms: pct(99),
      meanMs: Math.round(mean),
      maxMs: sorted[n - 1],
    });
  });

  app.get('/api/feature-registry/top-matches', (c) => {
    const windowHoursRaw = c.req.query('windowHours');
    const limitRaw = c.req.query('limit');
    const windowHours = Math.min(
      Math.max(parseFloat(windowHoursRaw ?? '24') || 24, 0.1),
      24 * 30,
    );
    const limit = Math.min(Math.max(parseInt(limitRaw ?? '10', 10) || 10, 1), 100);
    const since = Date.now() - windowHours * 60 * 60 * 1000;

    const rows = db.all(sql`
      SELECT
        l.top_match_id AS feature_id,
        f.name AS feature_name,
        f.project AS project,
        COUNT(*) AS match_count,
        AVG(l.top_score) AS avg_score
      FROM feature_registry_search_log l
      LEFT JOIN feature_registry f ON l.top_match_id = f.id
      WHERE l.created_at >= ${since}
        AND l.top_match_id IS NOT NULL
      GROUP BY l.top_match_id
      ORDER BY match_count DESC
      LIMIT ${limit}
    `) as Array<unknown>;

    return c.json({ windowHours, rows });
  });
}

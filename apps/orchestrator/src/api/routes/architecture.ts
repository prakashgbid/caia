/**
 * /api/architecture — ARCH-007 dashboard backend.
 *
 * Surfaces the AKG (Architecture Knowledge Graph) for the /architecture
 * page. Mirrors the FREG-007 shape so the two dashboards stay siblings.
 *
 *   GET  /api/architecture/summary
 *     → kindBreakdown, projectBreakdown, sourceBreakdown, totalArtifacts,
 *       totalEdges, recentExtractRunCount24h
 *
 *   GET  /api/architecture/recent?limit=N&kind=...&project=...
 *     → most recently extracted/upserted artifact rows (default 20)
 *
 *   GET  /api/architecture/by-domain?techSubDomain=frontend
 *     → all artifacts tagged with a given tech_sub_domain
 *
 *   GET  /api/architecture/extract-runs?limit=N
 *     → most recent extractor invocations (powers the "last extracted"
 *       panel)
 *
 *   GET  /api/architecture/edges?fromId=arch_x|toId=arch_y
 *     → directed dependency edges for a given artifact id
 */

import type { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { Db } from '../../db/connection';

// @no-events — observability route surfaces, no domain mutations
export function registerArchitectureRoutes(app: Hono, db: Db): void {
  app.get('/api/architecture/summary', (c) => {
    const totalRow = db.all(
      sql`SELECT COUNT(*) AS c FROM arch_artifacts`,
    ) as Array<{ c: number }>;
    const totalArtifacts = totalRow[0]?.c ?? 0;
    const edgesRow = db.all(
      sql`SELECT COUNT(*) AS c FROM arch_edges`,
    ) as Array<{ c: number }>;
    const totalEdges = edgesRow[0]?.c ?? 0;

    const kindBreakdown = db.all(
      sql`SELECT kind, COUNT(*) AS c FROM arch_artifacts GROUP BY kind ORDER BY c DESC`,
    ) as Array<{ kind: string; c: number }>;
    const projectBreakdown = db.all(
      sql`SELECT project, COUNT(*) AS c FROM arch_artifacts GROUP BY project ORDER BY c DESC`,
    ) as Array<{ project: string; c: number }>;
    const sourceBreakdown = db.all(
      sql`SELECT source, COUNT(*) AS c FROM arch_artifacts GROUP BY source ORDER BY c DESC`,
    ) as Array<{ source: string; c: number }>;

    const since = Date.now() - 24 * 3600 * 1000;
    const recentExtractRow = db.all(
      sql`SELECT COUNT(*) AS c FROM arch_extract_runs WHERE started_at > ${since}`,
    ) as Array<{ c: number }>;
    const recentExtractRunCount24h = recentExtractRow[0]?.c ?? 0;

    return c.json({
      totalArtifacts,
      totalEdges,
      kindBreakdown,
      projectBreakdown,
      sourceBreakdown,
      recentExtractRunCount24h,
    });
  });

  app.get('/api/architecture/recent', (c) => {
    const limit = clampInt(c.req.query('limit'), 1, 100, 20);
    const kind = c.req.query('kind');
    const project = c.req.query('project');
    const where: string[] = [];
    if (kind) where.push(`kind = '${escape(kind)}'`);
    if (project) where.push(`project = '${escape(project)}'`);
    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.all(
      sql.raw(
        `SELECT id, kind, project, name, description, entry_path, route_signature, table_name,
                package_name, design_system_tier, tech_sub_domains_json, tags_json, source,
                content_hash, embedding_model, created_at, updated_at
         FROM arch_artifacts
         ${whereSql}
         ORDER BY updated_at DESC
         LIMIT ${limit}`,
      ),
    ) as Array<Record<string, unknown>>;
    return c.json({ rows });
  });

  app.get('/api/architecture/by-domain', (c) => {
    const tsd = c.req.query('techSubDomain');
    if (!tsd) {
      return c.json({ error: 'techSubDomain query param required' }, 400);
    }
    const rows = db.all(
      sql.raw(
        `SELECT id, kind, project, name, description, entry_path, route_signature, table_name,
                package_name, design_system_tier, tech_sub_domains_json, tags_json, source,
                created_at, updated_at
         FROM arch_artifacts
         WHERE tech_sub_domains_json LIKE '%"${escape(tsd)}"%'
         ORDER BY kind, name
         LIMIT 200`,
      ),
    ) as Array<Record<string, unknown>>;
    return c.json({ techSubDomain: tsd, rows });
  });

  app.get('/api/architecture/extract-runs', (c) => {
    const limit = clampInt(c.req.query('limit'), 1, 100, 20);
    const rows = db.all(
      sql.raw(
        `SELECT id, extractor, started_at, finished_at, duration_ms, commit_sha,
                artifacts_inserted, artifacts_updated, artifacts_unchanged,
                edges_inserted, edges_updated, error
         FROM arch_extract_runs
         ORDER BY started_at DESC
         LIMIT ${limit}`,
      ),
    ) as Array<Record<string, unknown>>;
    return c.json({ rows });
  });

  app.get('/api/architecture/edges', (c) => {
    const fromId = c.req.query('fromId');
    const toId = c.req.query('toId');
    if (!fromId && !toId) {
      return c.json({ error: 'fromId or toId query param required' }, 400);
    }
    let rows: Array<Record<string, unknown>>;
    if (fromId && toId) {
      rows = db.all(
        sql.raw(
          `SELECT id, from_id, to_id, relation, weight, metadata_json, source, created_at, updated_at
           FROM arch_edges
           WHERE from_id = '${escape(fromId)}' AND to_id = '${escape(toId)}'
           LIMIT 200`,
        ),
      ) as Array<Record<string, unknown>>;
    } else if (fromId) {
      rows = db.all(
        sql.raw(
          `SELECT id, from_id, to_id, relation, weight, metadata_json, source, created_at, updated_at
           FROM arch_edges
           WHERE from_id = '${escape(fromId)}'
           ORDER BY relation
           LIMIT 200`,
        ),
      ) as Array<Record<string, unknown>>;
    } else {
      rows = db.all(
        sql.raw(
          `SELECT id, from_id, to_id, relation, weight, metadata_json, source, created_at, updated_at
           FROM arch_edges
           WHERE to_id = '${escape(toId!)}'
           ORDER BY relation
           LIMIT 200`,
        ),
      ) as Array<Record<string, unknown>>;
    }
    return c.json({ fromId: fromId ?? null, toId: toId ?? null, rows });
  });
}

function clampInt(
  raw: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Escape single quotes in a route param for raw-SQL embedding. */
function escape(s: string): string {
  return s.replace(/'/g, "''");
}

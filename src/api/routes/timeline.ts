import type { Hono } from 'hono';
import { desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { Db } from '../../db/connection';
import { getSqliteRaw } from '../../db/connection';
import { timelineEvents } from '../../db/schema';
import { bus } from '../../ws/bus';
import { getEntityIdsForDomains } from './domains';

type TimelineRow = typeof timelineEvents.$inferSelect;

// @no-events — route registration wrapper, individual handlers emit events
export function registerTimelineRoutes(app: Hono, db: Db): void {
  app.get('/timeline', (c) => {
    const {
      since, until, limit: lim, kind, actor, projectId,
      subject, cursor, search, export: exportFmt, domain,
    } = c.req.query() as Record<string, string>;

    const usePagination = !!(cursor || lim || search);
    const limitN = Math.min(parseInt(lim ?? '50', 10), 500);

    let rows: TimelineRow[];

    if (search) {
      // Use FTS5 for full-text search via raw SQLite
      try {
        const sqlite = getSqliteRaw();
        rows = sqlite.prepare(`
          SELECT te.* FROM timeline_events te
          JOIN timeline_fts f ON te.rowid = f.rowid
          WHERE timeline_fts MATCH ?
          ORDER BY te.created_at DESC
          LIMIT ?
        `).all(search, limitN + 1) as TimelineRow[];
      } catch {
        // FTS5 table may not exist yet (fresh DB); fall back to empty
        rows = [];
      }
    } else {
      rows = db
        .select()
        .from(timelineEvents)
        .orderBy(desc(timelineEvents.createdAt))
        .limit(usePagination ? limitN + 1 : limitN)
        .all();
    }

    // Apply post-fetch filters
    if (since) rows = rows.filter(r => r.createdAt >= since);
    if (until) rows = rows.filter(r => r.createdAt <= until);
    if (kind) {
      if (kind.endsWith('*')) {
        const prefix = kind.slice(0, -1);
        rows = rows.filter(r => r.kind.startsWith(prefix));
      } else {
        rows = rows.filter(r => r.kind === kind);
      }
    }
    if (actor) rows = rows.filter(r => r.actor === actor);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    if (subject) rows = rows.filter(r => r.subjectId === subject);
    if (domain) {
      const slugs = domain.split(',').map(s => s.trim()).filter(Boolean);
      if (slugs.length) {
        const ids = getEntityIdsForDomains(db, 'timeline', slugs);
        rows = rows.filter(r => ids.has(r.id));
      }
    }

    // Cursor-based pagination
    if (cursor) {
      const idx = rows.findIndex(r => r.id === cursor);
      if (idx >= 0) rows = rows.slice(idx + 1);
    }

    // CSV export
    if (exportFmt === 'csv') {
      const result = rows.slice(0, limitN);
      const csv = [
        'id,kind,actor,summary,subjectKind,subjectId,projectId,createdAt',
        ...result.map(r => [
          r.id,
          r.kind,
          r.actor,
          `"${r.summary.replace(/"/g, '""')}"`,
          r.subjectKind,
          r.subjectId,
          r.projectId ?? '',
          r.createdAt,
        ].join(',')),
      ].join('\n');
      return new Response(csv, {
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': 'attachment; filename="timeline.csv"',
        },
      });
    }

    // Paginated response (when cursor/limit explicitly provided)
    if (usePagination) {
      const hasMore = rows.length > limitN;
      const result = rows.slice(0, limitN);
      const nextCursor = hasMore ? (result[result.length - 1]?.id ?? null) : null;
      return c.json({ events: result, nextCursor, total: result.length });
    }

    // Legacy array response (backward compatible)
    return c.json(rows);
  });

  app.post('/timeline', async (c) => {
    const body = await c.req.json<Record<string, unknown>>();
    const now = new Date().toISOString();
    const id = 'tl_' + nanoid(8);
    const row = {
      id,
      kind: body['kind'] as string,
      actor: (body['actor'] as string | undefined) ?? 'system',
      summary: (body['summary'] as string | undefined) ?? '',
      subjectId: (body['subjectId'] as string | undefined) ?? '',
      subjectKind: (body['subjectKind'] as string | undefined) ?? '',
      payload: JSON.stringify(body['payload'] ?? {}),
      projectId: body['projectId'] as string | undefined,
      createdAt: now,
    };
    db.insert(timelineEvents).values(row).run();
    bus.push({ kind: 'timeline.event', id, projectId: row.projectId, payload: { ...row }, ts: now });
    return c.json(row, 201);
  });
}

import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { requirements, blockers, questions, tasks } from '../../db/schema';
import { getEntityIdsForDomains } from './domains';

function parseJson<T>(s: string | null | undefined): T {
  if (!s) return [] as unknown as T;
  try { return JSON.parse(s) as T; } catch { return [] as unknown as T; }
}

function parseDomainParam(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

// @no-events — route registration wrapper, individual handlers emit events
export function registerLegacyRoutes(app: Hono, db: Db): void {
  // Requirements
  app.get('/requirements', (c) => {
    const { state, priority, labels, projectId, domain } = c.req.query() as Record<string, string>;
    let rows = db.select().from(requirements).all();
    if (state) rows = rows.filter(r => r.state === state);
    if (priority) rows = rows.filter(r => r.priority === parseInt(priority, 10));
    if (labels) {
      const lbls = labels.split(',');
      rows = rows.filter(r => {
        const rl = parseJson<string[]>(r.labels);
        return lbls.some(l => rl.includes(l));
      });
    }
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    const domainSlugs = parseDomainParam(domain);
    if (domainSlugs.length) {
      const ids = getEntityIdsForDomains(db, 'requirement', domainSlugs);
      rows = rows.filter(r => ids.has(r.id));
    }
    return c.json(rows.map(r => ({
      ...r,
      labels: parseJson(r.labels),
      estimatedFiles: parseJson(r.estimatedFiles),
      dependsOn: parseJson(r.dependsOn),
      linkedTaskIds: parseJson(r.linkedTaskIds),
      spec: r.spec ? parseJson(r.spec) : undefined,
    })));
  });

  app.get('/requirements/:id', (c) => {
    const row = db.select().from(requirements).where(eq(requirements.id, c.req.param('id'))).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({
      ...row,
      labels: parseJson(row.labels),
      estimatedFiles: parseJson(row.estimatedFiles),
      dependsOn: parseJson(row.dependsOn),
      linkedTaskIds: parseJson(row.linkedTaskIds),
    });
  });

  // Blockers
  app.get('/blockers', (c) => {
    const { state, projectId, domain } = c.req.query() as Record<string, string>;
    let rows = db.select().from(blockers).all();
    if (state) rows = rows.filter(r => r.state === state);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    const domainSlugs = parseDomainParam(domain);
    if (domainSlugs.length) {
      const ids = getEntityIdsForDomains(db, 'blocker', domainSlugs);
      rows = rows.filter(r => ids.has(r.id));
    }
    return c.json(rows.map(r => ({
      ...r,
      resolutionSteps: parseJson(r.resolutionSteps),
      links: parseJson(r.links),
      approvalButton: r.approvalButton ? parseJson(r.approvalButton) : undefined,
    })));
  });

  app.get('/blockers/:id', (c) => {
    const row = db.select().from(blockers).where(eq(blockers.id, c.req.param('id'))).all()[0];
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...row, resolutionSteps: parseJson(row.resolutionSteps) });
  });

  // Questions
  app.get('/questions', (c) => {
    const { state, projectId, domain } = c.req.query() as Record<string, string>;
    let rows = db.select().from(questions).all();
    if (state) rows = rows.filter(r => r.state === state);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    const domainSlugs = parseDomainParam(domain);
    if (domainSlugs.length) {
      const ids = getEntityIdsForDomains(db, 'question', domainSlugs);
      rows = rows.filter(r => ids.has(r.id));
    }
    return c.json(rows.map(r => ({
      ...r,
      recommendations: parseJson(r.recommendations),
      answer: r.answer ? parseJson(r.answer) : undefined,
    })));
  });

  // Tasks
  app.get('/tasks', (c) => {
    const { status, projectId } = c.req.query() as Record<string, string>;
    let rows = db.select().from(tasks).all();
    if (status) rows = rows.filter(r => r.status === status);
    if (projectId) rows = rows.filter(r => r.projectId === projectId);
    return c.json(rows.map(r => ({
      ...r,
      declaredFiles: parseJson(r.declaredFiles),
      actualFiles: r.actualFiles ? parseJson(r.actualFiles) : undefined,
      dependsOn: parseJson(r.dependsOn),
    })));
  });

  // Counts
  app.get('/counts', (c) => {
    const { projectId } = c.req.query() as Record<string, string>;
    let blkRows = db.select().from(blockers).all().filter(r => r.state === 'open');
    let qRows = db.select().from(questions).all().filter(r => r.state === 'open');
    if (projectId) {
      blkRows = blkRows.filter(r => r.projectId === projectId);
      qRows = qRows.filter(r => r.projectId === projectId);
    }
    return c.json({ openBlockers: blkRows.length, openQuestions: qRows.length });
  });
}

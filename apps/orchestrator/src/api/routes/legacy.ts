import type { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { requirements, blockers, questions, tasks } from '../../db/schema';
import { getEntityIdsForDomains } from './domains';
import { eventBus } from '../../events/bus-adapter';

function genId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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

  // ─── Writers (DASH-205/206/207) ─────────────────────────────────────────
  // POST /blockers — create a new blocker (proxy already POSTs; backend was read-only)
  app.post('/blockers', async (c) => {
    const body = await c.req.json() as Partial<typeof blockers.$inferInsert>;
    if (!body.title) return c.json({ error: 'title is required' }, 400);
    const now = new Date().toISOString();
    const row: typeof blockers.$inferInsert = {
      id: body.id ?? genId('blk'),
      title: body.title,
      severity: body.severity ?? 'normal',
      kind: body.kind ?? 'info',
      description: body.description ?? '',
      resolutionSteps: body.resolutionSteps ?? '[]',
      approvalButton: body.approvalButton ?? null,
      links: body.links ?? '[]',
      state: body.state ?? 'open',
      requirementId: body.requirementId ?? null,
      taskId: body.taskId ?? null,
      resolvedAt: body.resolvedAt ?? null,
      resolvedBy: body.resolvedBy ?? null,
      resolutionNote: body.resolutionNote ?? null,
      projectId: body.projectId ?? null,
      scope: body.scope ?? 'global',
      createdAt: body.createdAt ?? now,
      rootPromptId: body.rootPromptId ?? null,
      parentEntityType: body.parentEntityType ?? null,
      parentEntityId: body.parentEntityId ?? null,
    };
    db.insert(blockers).values(row).run();
    eventBus.publish({
      type: 'blocker.created',
      actor: 'api',
      entity_type: 'blocker',
      entity_id: row.id,
      payload: { blocker_id: row.id, title: row.title, severity: row.severity, kind: row.kind },
    });
    return c.json(row, 201);
  });

  // POST /blockers/:id/resolve — flip to resolved + emit event
  app.post('/blockers/:id/resolve', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as { resolution_note?: string; resolved_by?: string };
    const existing = db.select().from(blockers).where(eq(blockers.id, id)).get();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    if (existing.state === 'resolved') return c.json({ ...existing, alreadyResolved: true });

    const now = new Date().toISOString();
    db.update(blockers).set({
      state: 'resolved',
      resolvedAt: now,
      resolvedBy: body.resolved_by ?? 'api',
      resolutionNote: body.resolution_note ?? null,
    }).where(eq(blockers.id, id)).run();

    eventBus.publish({
      type: 'blocker.resolved',
      actor: 'api',
      entity_type: 'blocker',
      entity_id: id,
      payload: {
        blocker_id: id,
        resolved_by: body.resolved_by ?? 'api',
        resolution_note: body.resolution_note ?? null,
      },
    });

    const updated = db.select().from(blockers).where(eq(blockers.id, id)).get();
    return c.json(updated);
  });

  // POST /questions — create a new question
  app.post('/questions', async (c) => {
    const body = await c.req.json() as Partial<typeof questions.$inferInsert>;
    if (!body.title) return c.json({ error: 'title is required' }, 400);
    const now = new Date().toISOString();
    const row: typeof questions.$inferInsert = {
      id: body.id ?? genId('qst'),
      title: body.title,
      priority: body.priority ?? 'normal',
      context: body.context ?? '',
      recommendations: body.recommendations ?? '[]',
      customAnswerPlaceholder: body.customAnswerPlaceholder ?? null,
      state: body.state ?? 'open',
      requirementId: body.requirementId ?? null,
      taskId: body.taskId ?? null,
      answer: body.answer ?? null,
      answeredAt: body.answeredAt ?? null,
      projectId: body.projectId ?? null,
      scope: body.scope ?? 'global',
      createdAt: body.createdAt ?? now,
      rootPromptId: body.rootPromptId ?? null,
      parentEntityType: body.parentEntityType ?? null,
      parentEntityId: body.parentEntityId ?? null,
    };
    db.insert(questions).values(row).run();
    eventBus.publish({
      type: 'question.created',
      actor: 'api',
      entity_type: 'question',
      entity_id: row.id,
      payload: { question_id: row.id, title: row.title, priority: row.priority },
    });
    return c.json(row, 201);
  });

  // POST /questions/:id/answer — record an answer + emit event
  app.post('/questions/:id/answer', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({})) as { answer?: unknown };
    if (body.answer == null) return c.json({ error: 'answer is required' }, 400);
    const existing = db.select().from(questions).where(eq(questions.id, id)).get();
    if (!existing) return c.json({ error: 'Not found' }, 404);

    const now = new Date().toISOString();
    const answerJson = typeof body.answer === 'string' ? body.answer : JSON.stringify(body.answer);

    db.update(questions).set({
      answer: answerJson,
      answeredAt: now,
      state: 'answered',
    }).where(eq(questions.id, id)).run();

    eventBus.publish({
      type: 'question.answered',
      actor: 'api',
      entity_type: 'question',
      entity_id: id,
      payload: { question_id: id, answer_summary: typeof body.answer === 'string' ? body.answer.slice(0, 200) : '<json>' },
    });

    const updated = db.select().from(questions).where(eq(questions.id, id)).get();
    return c.json(updated);
  });

  // GET /questions/:id — fetch single question
  app.get('/questions/:id', (c) => {
    const row = db.select().from(questions).where(eq(questions.id, c.req.param('id'))).get();
    if (!row) return c.json({ error: 'Not found' }, 404);
    return c.json({ ...row, recommendations: parseJson(row.recommendations), answer: row.answer ? parseJson(row.answer) : undefined });
  });

  // PATCH /questions/:id — update fields
  app.patch('/questions/:id', async (c) => {
    const id = c.req.param('id');
    const body = await c.req.json() as Partial<typeof questions.$inferInsert>;
    const existing = db.select().from(questions).where(eq(questions.id, id)).get();
    if (!existing) return c.json({ error: 'Not found' }, 404);
    db.update(questions).set(body).where(eq(questions.id, id)).run();
    const updated = db.select().from(questions).where(eq(questions.id, id)).get();
    return c.json(updated);
  });

  // POST /requirements — create new requirement (proxy already POSTs; backend was read-only)
  app.post('/requirements', async (c) => {
    const body = await c.req.json() as Partial<typeof requirements.$inferInsert>;
    if (!body.title) return c.json({ error: 'title is required' }, 400);
    const now = new Date().toISOString();
    const row: typeof requirements.$inferInsert = {
      id: body.id ?? genId('req'),
      title: body.title,
      description: body.description ?? '',
      state: body.state ?? 'captured',
      priority: body.priority ?? 3,
      labels: body.labels ?? '[]',
      targetProject: body.targetProject ?? null,
      estimatedFiles: body.estimatedFiles ?? '[]',
      dependsOn: body.dependsOn ?? '[]',
      linkedTaskIds: body.linkedTaskIds ?? '[]',
      spec: body.spec ?? null,
      projectId: body.projectId ?? null,
      scope: body.scope ?? 'global',
      createdAt: body.createdAt ?? now,
      updatedAt: body.updatedAt ?? now,
      rootPromptId: body.rootPromptId ?? null,
      parentEntityType: body.parentEntityType ?? null,
      parentEntityId: body.parentEntityId ?? null,
    };
    db.insert(requirements).values(row).run();
    eventBus.publish({
      type: 'requirement.created',
      actor: 'api',
      entity_type: 'requirement',
      entity_id: row.id,
      payload: { requirement_id: row.id, title: row.title, state: row.state, priority: row.priority },
    });
    return c.json(row, 201);
  });
}

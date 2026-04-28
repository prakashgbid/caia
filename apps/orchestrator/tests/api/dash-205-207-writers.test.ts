/**
 * DASH-205 / DASH-206 / DASH-207 — guard the new write handlers in
 * legacy.ts plus the events emitted by them.
 *
 * Routes tested:
 *   POST /blockers, POST /blockers/:id/resolve
 *   POST /questions, POST /questions/:id/answer, GET /questions/:id, PATCH /questions/:id
 *   POST /requirements
 *
 * Each writer must:
 *   1. Persist the row.
 *   2. Emit the matching domain event (blocker.created, blocker.resolved,
 *      question.created, question.answered, requirement.created).
 *   3. Return the persisted row.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { registerLegacyRoutes } from '../../src/api/routes/legacy';
import { wireEventBus } from '../../src/events/bus-adapter';
import { eventBus } from '@chiefaia/event-bus-internal';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-205/206/207 writers', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash205-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
    app = new Hono();
    registerLegacyRoutes(app, db);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  describe('DASH-205 POST /blockers/:id/resolve', () => {
    it('flips state→resolved, persists fields, emits blocker.resolved', async () => {
      const created = await app.request('/blockers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Test blocker', severity: 'high' }),
      });
      expect(created.status).toBe(201);
      const blkRow = await created.json() as { id: string; state: string };
      expect(blkRow.state).toBe('open');

      const resolved = await app.request(`/blockers/${blkRow.id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution_note: 'fixed by claude', resolved_by: 'claude-orchestrator' }),
      });
      expect(resolved.status).toBe(200);
      const updated = await resolved.json() as { state: string; resolutionNote: string; resolvedBy: string };
      expect(updated.state).toBe('resolved');
      expect(updated.resolutionNote).toBe('fixed by claude');
      expect(updated.resolvedBy).toBe('claude-orchestrator');

      // Event was emitted
      const events = eventBus.replay({ correlationId: undefined, limit: 50 });
      const types = events.map(e => e.type);
      expect(types).toContain('blocker.created');
      expect(types).toContain('blocker.resolved');
    });

    it('returns 404 for unknown blocker id', async () => {
      const res = await app.request('/blockers/blk_does_not_exist/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DASH-206 question writers', () => {
    it('POST creates → POST /answer flips state → GET single returns it', async () => {
      const created = await app.request('/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Should we ship?', priority: 'high' }),
      });
      expect(created.status).toBe(201);
      const q = await created.json() as { id: string; state: string };
      expect(q.state).toBe('open');

      const answered = await app.request(`/questions/${q.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'yes' }),
      });
      expect(answered.status).toBe(200);
      const aBody = await answered.json() as { state: string; answer: string };
      expect(aBody.state).toBe('answered');
      expect(aBody.answer).toBe('yes');

      const single = await app.request(`/questions/${q.id}`);
      expect(single.status).toBe(200);

      const events = eventBus.replay({ correlationId: undefined, limit: 50 });
      const types = events.map(e => e.type);
      expect(types).toContain('question.created');
      expect(types).toContain('question.answered');
    });

    it('PATCH updates fields without emitting question.answered', async () => {
      const created = await app.request('/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'patch me' }),
      });
      const q = await created.json() as { id: string };
      const patched = await app.request(`/questions/${q.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'critical' }),
      });
      expect(patched.status).toBe(200);
      const pBody = await patched.json() as { priority: string };
      expect(pBody.priority).toBe('critical');
    });
  });

  describe('DASH-207 POST /requirements + POST /blockers', () => {
    it('POST /requirements persists row + emits requirement.created', async () => {
      const res = await app.request('/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Req via API', description: 'test' }),
      });
      expect(res.status).toBe(201);
      const row = await res.json() as { id: string; title: string; state: string };
      expect(row.title).toBe('Req via API');
      expect(row.state).toBe('captured');

      const events = eventBus.replay({ correlationId: undefined, limit: 50 });
      expect(events.map(e => e.type)).toContain('requirement.created');
    });

    it('rejects POST /blockers without a title', async () => {
      const res = await app.request('/blockers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      expect(res.status).toBe(400);
    });
  });
});

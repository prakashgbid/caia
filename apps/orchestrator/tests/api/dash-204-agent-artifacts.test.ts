/**
 * DASH-204 — guard the /agents/artifacts CRUD + events.
 *
 * The dashboard's /gates page uses these routes to surface and act on
 * agent artifacts (architecture-plan, backlog-review, etc.):
 *   GET    /agents/artifacts?status=draft
 *   GET    /agents/artifacts/:id
 *   POST   /agents/artifacts
 *   PATCH  /agents/artifacts/:id   {status: 'approved'|'rejected'|'superseded'}
 *
 * Each artifact lifecycle event must reach the event bus so the layout's
 * review-gates badge and any future timeline subscribers can update live.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { registerAgentRoutes } from '../../src/api/routes/agents';
import { wireEventBus } from '../../src/events/bus-adapter';
import { eventBus } from '@chiefaia/event-bus-internal';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-204 /agents/artifacts CRUD', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash204-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
    app = new Hono();
    registerAgentRoutes(app, db);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('POST creates → emits artifact.draft_filed → GET /:id returns it', async () => {
    const created = await app.request('/agents/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'po-agent',
        artifactType: 'backlog-review',
        content: '{"items":[]}',
        // promptId omitted to avoid FK constraint in test
      }),
    });
    expect(created.status).toBe(201);
    const { artifact_id } = await created.json() as { artifact_id: string };
    expect(artifact_id).toMatch(/^art-/);

    const single = await app.request(`/agents/artifacts/${artifact_id}`);
    expect(single.status).toBe(200);
    const row = await single.json() as { id: string; status: string; agentName: string };
    expect(row.id).toBe(artifact_id);
    expect(row.status).toBe('draft');
    expect(row.agentName).toBe('po-agent');

    const events = eventBus.replay({ correlationId: undefined, limit: 50 });
    expect(events.map(e => e.type)).toContain('artifact.draft_filed');
  });

  it('PATCH status=approved → emits artifact.approved + persists', async () => {
    const created = await app.request('/agents/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'po', artifactType: 't', content: '{}' }),
    });
    const { artifact_id } = await created.json() as { artifact_id: string };

    const patched = await app.request(`/agents/artifacts/${artifact_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'approved' }),
    });
    expect(patched.status).toBe(200);
    const updated = await patched.json() as { status: string };
    expect(updated.status).toBe('approved');

    const events = eventBus.replay({ correlationId: undefined, limit: 50 });
    expect(events.map(e => e.type)).toContain('artifact.approved');
  });

  it('PATCH status=superseded → emits artifact.superseded with feedback', async () => {
    const created = await app.request('/agents/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'po', artifactType: 't', content: '{}' }),
    });
    const { artifact_id } = await created.json() as { artifact_id: string };

    const patched = await app.request(`/agents/artifacts/${artifact_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'superseded', feedback: 'try again' }),
    });
    expect(patched.status).toBe(200);

    const events = eventBus.replay({ correlationId: undefined, limit: 50 });
    const supersededEvent = events.find(e => e.type === 'artifact.superseded');
    expect(supersededEvent).toBeDefined();
    expect((supersededEvent!.payload as { feedback?: string }).feedback).toBe('try again');
  });

  it('rejects PATCH with an invalid status', async () => {
    const created = await app.request('/agents/artifacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentName: 'po', artifactType: 't', content: '{}' }),
    });
    const { artifact_id } = await created.json() as { artifact_id: string };

    const patched = await app.request(`/agents/artifacts/${artifact_id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'banana' }),
    });
    expect(patched.status).toBe(400);
  });

  it('GET /:id returns 404 for unknown id', async () => {
    const res = await app.request('/agents/artifacts/art-does-not-exist');
    expect(res.status).toBe(404);
  });
});

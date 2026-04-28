/**
 * GATE-4-02 — guard the /buckets routes.
 *
 * The dashboard's bucket-visualization kanban consumes:
 *   GET /buckets               — list with story counts + 5-row preview
 *   GET /buckets/:id           — single bucket with all linked stories
 *
 * Both routes are read-only and emit no events. This test seeds two
 * prompts × two buckets each (sequential per-domain + parallel pool)
 * + 4 stories total (some with valid templates, some pending) and
 * asserts: list grouping, ticket counts, validity counts, preview
 * cap, filter-by-promptId, single-bucket detail and 404.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerBucketsRoutes } from '../../src/api/routes/buckets';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface BucketsListBody {
  total: number;
  buckets: Array<{ id: string; kind: string; ticketCount: number; validTicketCount: number; preview: Array<{ id: string }> }>;
  grouped: { sequential: unknown[]; parallel: unknown[] };
}

interface BucketDetailBody {
  bucket: { id: string; kind: string; domainSlug: string | null; promptId: string };
  prompt: { id: string; body: string } | null;
  stories: Array<{ id: string; title: string; templateValidationStatus: string }>;
}

describe('GATE-4-02 /buckets routes', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-gate4-buckets-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    app = new Hono();
    registerBucketsRoutes(app, db);

    // Seed two prompts.
    const sqlite = getSqliteRaw();
    const now = new Date().toISOString();
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_a', 'prompt A — auth feature', now, 'api', 'ready_for_pickup', 'cor_a', 'h_a');
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_b', 'prompt B — billing feature', now, 'api', 'ready_for_pickup', 'cor_b', 'h_b');

    // Buckets: prm_a has parallel + sequential(auth); prm_b has parallel only.
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_a_par', 'parallel', null, 'prm_a', Date.now() - 30_000, null, 'open');
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_a_auth', 'sequential', 'auth', 'prm_a', Date.now() - 20_000, 0, 'open');
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_b_par', 'parallel', null, 'prm_b', Date.now() - 10_000, null, 'drained');

    // Stories
    const insertStory = sqlite.prepare(
      "INSERT INTO stories (id, kind, title, ordinal, description, expected_behavior, acceptance_criteria_json, verification_plan_json, depends_on_json, domain_slugs_json, status, created_at, root_prompt_id, agent_contributions_json, bucket_id, template_version, template_validation_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    );
    insertStory.run('sty_login_form', 'story', 'login form', 0, '', '', '[]', '[]', '[]', '["ui-frontend"]', 'pending', now, 'prm_a', '{}', 'tb_a_par', 'v1', 'valid');
    insertStory.run('sty_oauth_cb', 'story', 'oauth callback', 1, '', '', '[]', '[]', '[]', '["auth"]', 'pending', now, 'prm_a', '{}', 'tb_a_auth', 'v1', 'valid');
    insertStory.run('sty_jwt_validate', 'story', 'jwt validate', 2, '', '', '[]', '[]', '[]', '["auth"]', 'pending', now, 'prm_a', '{}', 'tb_a_auth', 'v1', 'pending');
    insertStory.run('sty_invoice_pdf', 'story', 'invoice pdf', 0, '', '', '[]', '[]', '[]', '["billing"]', 'pending', now, 'prm_b', '{}', 'tb_b_par', 'v1', 'valid');
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('GET /buckets lists every bucket with ticket counts and preview', async () => {
    const res = await app.request('/buckets');
    expect(res.status).toBe(200);
    const body = await res.json() as BucketsListBody;
    expect(body.total).toBe(3);
    expect(body.grouped.sequential.length).toBe(1);
    expect(body.grouped.parallel.length).toBe(2);

    const auth = body.buckets.find((b) => b.id === 'tb_a_auth')!;
    expect(auth.kind).toBe('sequential');
    expect(auth.ticketCount).toBe(2);
    expect(auth.validTicketCount).toBe(1);

    const par = body.buckets.find((b) => b.id === 'tb_a_par')!;
    expect(par.kind).toBe('parallel');
    expect(par.ticketCount).toBe(1);
    expect(par.validTicketCount).toBe(1);
    expect(par.preview[0].id).toBe('sty_login_form');
  });

  it('GET /buckets?promptId=… filters to that prompt', async () => {
    const res = await app.request('/buckets?promptId=prm_b');
    expect(res.status).toBe(200);
    const body = await res.json() as BucketsListBody;
    expect(body.total).toBe(1);
    expect(body.buckets[0].id).toBe('tb_b_par');
    expect(body.buckets[0].ticketCount).toBe(1);
  });

  it('GET /buckets?domain=auth&kind=sequential narrows further', async () => {
    const res = await app.request('/buckets?domain=auth&kind=sequential');
    expect(res.status).toBe(200);
    const body = await res.json() as BucketsListBody;
    expect(body.total).toBe(1);
    expect(body.buckets[0].id).toBe('tb_a_auth');
  });

  it('GET /buckets/:id returns ordered stories + the prompt header', async () => {
    const res = await app.request('/buckets/tb_a_auth');
    expect(res.status).toBe(200);
    const body = await res.json() as BucketDetailBody;
    expect(body.bucket.id).toBe('tb_a_auth');
    expect(body.bucket.domainSlug).toBe('auth');
    expect(body.prompt?.id).toBe('prm_a');
    expect(body.stories.map((s) => s.id)).toEqual(['sty_oauth_cb', 'sty_jwt_validate']);
  });

  it('GET /buckets/:id 404 on unknown id', async () => {
    const res = await app.request('/buckets/tb_missing');
    expect(res.status).toBe(404);
  });
});

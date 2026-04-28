/**
 * GATE-4-03 — guard the GET /stories/:id/bundle route exposure.
 *
 * The dashboard's story-detail page (TicketBundleViewer) consumes this
 * route via the `/api/stories/:id/bundle` proxy. The bundle assembler
 * itself is covered by `tests/api/ticket-bundle.test.ts`; this test
 * pins the route — Hono handler + 404 + JSON envelope — so the
 * dashboard's contract is enforceable from CI.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerStoriesRoutes } from '../../src/api/routes/stories';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface BundleBody {
  story: { id: string; title: string; templateValidationStatus: string };
  ticket: unknown;
  ticketParseError: string | null;
  prompt: { id: string; body: string } | null;
  bucket: { id: string; kind: string } | null;
  labels: Array<{ labelSlug: string; labelType: string }>;
  dependencies: { upstream: string[]; downstream: string[] };
}

describe('GATE-4-03 GET /stories/:id/bundle', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-gate4-bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    app = new Hono();
    registerStoriesRoutes(app, db);

    const sqlite = getSqliteRaw();
    const now = new Date().toISOString();

    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_bundle_route', 'add login', now, 'api', 'ready_for_pickup', 'cor_bundle_route', 'h');

    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('bkt_seq_auth', 'sequential', 'auth', 'prm_bundle_route', Date.now(), 0, 'open');

    // Empty agentContributionsJson `{}` — bundle returns ticket=null without parse error.
    sqlite.prepare(
      "INSERT INTO stories (id, kind, title, ordinal, description, expected_behavior, acceptance_criteria_json, verification_plan_json, depends_on_json, domain_slugs_json, status, created_at, root_prompt_id, agent_contributions_json, bucket_id, template_version, template_validation_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('sty_bundled', 'story', 'login form ticket', 0, '', '', '[]', '[]', '[]', '["ui-frontend"]', 'pending', now, 'prm_bundle_route', '{}', 'bkt_seq_auth', 'v1', 'pending');

    // Entity labels — surfaced on the bundle.
    sqlite.prepare(
      "INSERT INTO entity_labels (id, entity_kind, entity_id, label_slug, label_type, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('el_1', 'story', 'sty_bundled', 'auth', 'domain', 0.9, 'classifier', Date.now());
    sqlite.prepare(
      "INSERT INTO entity_labels (id, entity_kind, entity_id, label_slug, label_type, confidence, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('el_2', 'story', 'sty_bundled', 'feature', 'nature', 0.8, 'classifier', Date.now());
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('returns 404 for an unknown story', async () => {
    const res = await app.request('/stories/sty_does_not_exist/bundle');
    expect(res.status).toBe(404);
  });

  it('returns the self-contained bundle envelope', async () => {
    const res = await app.request('/stories/sty_bundled/bundle');
    expect(res.status).toBe(200);
    const body = await res.json() as BundleBody;
    expect(body.story.id).toBe('sty_bundled');
    expect(body.story.title).toBe('login form ticket');
    expect(body.story.templateValidationStatus).toBe('pending');
    expect(body.prompt?.id).toBe('prm_bundle_route');
    expect(body.bucket?.id).toBe('bkt_seq_auth');
    expect(body.bucket?.kind).toBe('sequential');
    // Empty `{}` agentContributionsJson — assembler treats as a stub.
    expect(body.ticket).toBeNull();
    expect(body.ticketParseError).toBeNull();
    // Labels (2) and dependency-mirror lists (empty here)
    expect(body.labels.length).toBe(2);
    expect(body.dependencies.upstream).toEqual([]);
    expect(body.dependencies.downstream).toEqual([]);
  });
});

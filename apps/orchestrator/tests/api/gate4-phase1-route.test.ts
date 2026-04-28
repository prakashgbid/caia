/**
 * GATE-4-01 — guard the /prompts/:id/phase1 contract.
 *
 * The dashboard's `/prompts/[id]/journey` page consumes this endpoint to
 * render the live Phase-1 timeline: pipeline-stage transitions, stories
 * (with template/bucket linkage), bucket placement, BA agent-collab
 * thread, and the Phase-1 event subset filtered to the prompt's
 * correlation id (and any per-story sub-correlation `${corr}::${storyId}`).
 *
 * The endpoint is read-only; this test seeds the data the Phase-1
 * pipeline would have written and asserts the full envelope shape.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerPromptsRoutes } from '../../src/api/routes/prompts';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface Phase1Response {
  prompt: { id: string; body: string; correlationId: string; status: string; receivedAt: string };
  pipelineStages: Array<{ stage: string; enteredAt: number; durationMs: number | null }>;
  stories: Array<{ id: string; title: string; bucketId: string | null; templateValidationStatus: string; acceptanceCriteriaCount: number }>;
  buckets: Array<{ id: string; kind: string; domainSlug: string | null; storyIds: string[] }>;
  agentMessages: Array<{ id: string; fromAgent: string; toAgent: string; messageType: string; correlationId: string }>;
  phase1Events: Array<{ id: string; type: string; correlationId: string }>;
}

describe('GATE-4-01 GET /prompts/:id/phase1', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-gate4-phase1-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    app = new Hono();
    registerPromptsRoutes(app, db);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('returns 404 for an unknown prompt', async () => {
    const res = await app.request('/prompts/prm_missing/phase1');
    expect(res.status).toBe(404);
  });

  it('assembles every Phase-1 surface in one envelope', async () => {
    const sqlite = getSqliteRaw();
    const now = new Date().toISOString();
    const correlationId = 'cor_phase1_test';

    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_p1', 'add user login', now, 'api', 'ready_for_pickup', correlationId, 'h1');

    // Pipeline stages — the full Phase-1 sequence with monotonically
    // increasing enteredAt so the ordering assertion is meaningful.
    const stagesSeq = ['ingested', 'scaffolded', 'po_decomposed', 'ba_enriched', 'bucket_placed', 'ready_for_pickup'];
    let t = Date.now() - 60_000;
    for (const stage of stagesSeq) {
      sqlite.prepare(
        "INSERT INTO prompt_pipeline_stages (id, prompt_id, stage, entity_kind, entity_id, entered_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(`pps_${stage}`, 'prm_p1', stage, 'prompt', 'prm_p1', t);
      t += 5_000;
    }

    // Buckets — one parallel + one sequential domain bucket.
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_parallel', 'parallel', null, 'prm_p1', Date.now(), null, 'open');
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_seq_auth', 'sequential', 'auth', 'prm_p1', Date.now(), 0, 'open');

    // Two stories — one in the parallel pool, one in the sequential auth bucket.
    sqlite.prepare(
      "INSERT INTO stories (id, kind, title, description, expected_behavior, acceptance_criteria_json, verification_plan_json, depends_on_json, domain_slugs_json, status, created_at, root_prompt_id, agent_contributions_json, bucket_id, template_version, template_validation_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      'sty_login_form',
      'story',
      'login form UI',
      '',
      '',
      '["AC1","AC2","AC3"]',
      '[]',
      '[]',
      '["ui-frontend"]',
      'pending',
      now,
      'prm_p1',
      '{}',
      'tb_parallel',
      'v1',
      'valid',
    );
    sqlite.prepare(
      "INSERT INTO stories (id, kind, title, description, expected_behavior, acceptance_criteria_json, verification_plan_json, depends_on_json, domain_slugs_json, status, created_at, root_prompt_id, agent_contributions_json, bucket_id, template_version, template_validation_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      'sty_oauth_callback',
      'story',
      'oauth callback',
      '',
      '',
      '["AC1","AC2","AC3","AC4"]',
      '[]',
      '[]',
      '["auth"]',
      'pending',
      now,
      'prm_p1',
      '{}',
      'tb_seq_auth',
      'v1',
      'valid',
    );

    // BA collaboration messages — under a per-story sub-correlation.
    const subCorr = `${correlationId}::sty_login_form`;
    sqlite.prepare(
      "INSERT INTO agent_messages (id, from_agent, to_agent, message_type, correlation_id, payload, status, created_at, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('am_req_1', 'ba-agent', 'ui-agent', 'input-requested', subCorr, '{"section":"ui"}', 'replied', Date.now() - 10_000, null);
    sqlite.prepare(
      "INSERT INTO agent_messages (id, from_agent, to_agent, message_type, correlation_id, payload, status, created_at, parent_message_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('am_resp_1', 'ui-agent', 'ba-agent', 'input-received', subCorr, '{"ok":true}', 'processed', Date.now() - 5_000, 'am_req_1');

    // Phase-1 events — at the prompt correlation and at a sub-correlation.
    const ev = (id: string, type: string, corr: string) => sqlite.prepare(
      "INSERT INTO events (id, type, occurred_at, actor, correlation_id, entity_type, entity_id, payload_json, metadata_json, severity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(id, type, new Date().toISOString(), 'system', corr, 'prompt', 'prm_p1', '{}', '{}', 'info');
    ev('e_ingested', 'pipeline.stage.advanced', correlationId);
    ev('e_po_dec', 'po-agent.decomposition.complete', correlationId);
    ev('e_ba_in', 'ba-agent.input-requested', subCorr);
    ev('e_ba_out', 'ba-agent.input-received', subCorr);
    ev('e_ba_done', 'ba-agent.enrichment.complete', correlationId);
    ev('e_bucket', 'task-scheduler.bucket-placed', correlationId);
    ev('e_ready', 'ticket.ready-for-pickup', correlationId);
    // An unrelated event under a different correlation must NOT appear.
    ev('e_other', 'task.created', 'cor_unrelated');

    const res = await app.request('/prompts/prm_p1/phase1');
    expect(res.status).toBe(200);
    const body = await res.json() as Phase1Response;

    // Prompt header
    expect(body.prompt.id).toBe('prm_p1');
    expect(body.prompt.correlationId).toBe(correlationId);
    expect(body.prompt.status).toBe('ready_for_pickup');

    // Pipeline stages: full sequence in order
    expect(body.pipelineStages.map((s) => s.stage)).toEqual(stagesSeq);

    // Stories: both present, ac counts honored, bucket linkage present
    expect(body.stories.length).toBe(2);
    const formStory = body.stories.find((s) => s.id === 'sty_login_form')!;
    expect(formStory.bucketId).toBe('tb_parallel');
    expect(formStory.acceptanceCriteriaCount).toBe(3);
    expect(formStory.templateValidationStatus).toBe('valid');
    const oauthStory = body.stories.find((s) => s.id === 'sty_oauth_callback')!;
    expect(oauthStory.bucketId).toBe('tb_seq_auth');
    expect(oauthStory.acceptanceCriteriaCount).toBe(4);

    // Buckets: both present with their story ids back-linked
    expect(body.buckets.length).toBe(2);
    const parallel = body.buckets.find((b) => b.id === 'tb_parallel')!;
    expect(parallel.kind).toBe('parallel');
    expect(parallel.storyIds).toEqual(['sty_login_form']);
    const seq = body.buckets.find((b) => b.id === 'tb_seq_auth')!;
    expect(seq.kind).toBe('sequential');
    expect(seq.domainSlug).toBe('auth');
    expect(seq.storyIds).toEqual(['sty_oauth_callback']);

    // Agent messages: both BA collab rows surfaced; reply linked
    expect(body.agentMessages.length).toBe(2);
    expect(body.agentMessages[0].id).toBe('am_req_1');
    expect(body.agentMessages[1].id).toBe('am_resp_1');

    // Phase-1 events: only the seven correlated ones (incl. sub-corr),
    // never the cor_unrelated row.
    const eventTypes = body.phase1Events.map((e) => e.type);
    expect(eventTypes).toContain('pipeline.stage.advanced');
    expect(eventTypes).toContain('po-agent.decomposition.complete');
    expect(eventTypes).toContain('ba-agent.input-requested');
    expect(eventTypes).toContain('ba-agent.input-received');
    expect(eventTypes).toContain('ba-agent.enrichment.complete');
    expect(eventTypes).toContain('task-scheduler.bucket-placed');
    expect(eventTypes).toContain('ticket.ready-for-pickup');
    expect(eventTypes).not.toContain('task.created');
    // All correlations either match the prompt's or have its prefix.
    for (const e of body.phase1Events) {
      expect(
        e.correlationId === correlationId ||
        e.correlationId.startsWith(`${correlationId}::`),
      ).toBe(true);
    }
  });
});

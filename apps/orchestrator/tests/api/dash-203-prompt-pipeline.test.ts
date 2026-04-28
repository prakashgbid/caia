/**
 * DASH-203 — guard the /prompts/:id/pipeline contract.
 *
 * The dashboard's /pipeline page expects this endpoint to return a
 * PipelineData envelope:
 *   { promptId, promptBody, promptReceivedAt, promptStatus,
 *     requirements: [{ id, title, status, stories: [
 *       { id, title, status, tasks: [
 *         { id, title, status, taskRuns: [...] }
 *       ]}
 *     ]}],
 *     totalDurationMs, totalTokensIn, totalTokensOut,
 *     totalFilesChanged, overallStatus }
 *
 * This test seeds a prompt → requirement → story → task → taskRun chain
 * and verifies the route returns the dashboard-friendly envelope.
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerPromptsRoutes } from '../../src/api/routes/prompts';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-203 GET /prompts/:id/pipeline', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash203-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
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

  it('returns 404 for an unknown prompt id', async () => {
    const res = await app.request('/prompts/prm_does_not_exist/pipeline');
    expect(res.status).toBe(404);
  });

  it('returns the PipelineData envelope with seeded requirements/stories/tasks/runs', async () => {
    const sqlite = getSqliteRaw();
    const now = new Date().toISOString();

    // Seed prompt
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_dash203', 'Build a feature', now, 'user', 'received', 'prm_dash203', 'h1');

    // Seed requirement
    sqlite.prepare(
      "INSERT INTO requirements (id, title, description, state, priority, labels, target_project, estimated_files, depends_on, linked_task_ids, scope, created_at, updated_at, root_prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('req_1', 'Req One', '', 'captured', 3, '[]', null, '[]', '[]', '[]', 'global', now, now, 'prm_dash203');

    // Seed story (under the prompt)
    sqlite.prepare(
      "INSERT INTO stories (id, kind, title, description, expected_behavior, acceptance_criteria_json, verification_plan_json, depends_on_json, domain_slugs_json, status, created_at, root_prompt_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('sty_1', 'story', 'Story One', '', '', '[]', '[]', '[]', '[]', 'pending', now, 'prm_dash203');

    // Seed task (under the story)
    sqlite.prepare(
      "INSERT INTO tasks (id, title, status, cwd, created_at, attempt_count, paused, root_prompt_id, parent_entity_type, parent_entity_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).run('tsk_1', 'Task One', 'queued', '/tmp', now, 0, 0, 'prm_dash203', 'story', 'sty_1');

    const res = await app.request('/prompts/prm_dash203/pipeline');
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;

    // Top-level shape
    expect(body.promptId).toBe('prm_dash203');
    expect(body.promptBody).toBe('Build a feature');
    expect(body.promptReceivedAt).toBe(now);
    expect(body.promptStatus).toBe('received');
    expect(Array.isArray(body.requirements)).toBe(true);
    expect(typeof body.overallStatus).toBe('string');

    // Requirement → story → task chain is present
    const reqs = body.requirements as Array<{ id: string; title: string; status: string; stories: Array<{ id: string; title: string; tasks: Array<{ id: string; title: string }> }> }>;
    expect(reqs.length).toBe(1);
    expect(reqs[0].id).toBe('req_1');
    expect(reqs[0].title).toBe('Req One');
    expect(reqs[0].stories.length).toBe(1);
    expect(reqs[0].stories[0].id).toBe('sty_1');
    expect(reqs[0].stories[0].tasks.length).toBe(1);
    expect(reqs[0].stories[0].tasks[0].id).toBe('tsk_1');
  });
});

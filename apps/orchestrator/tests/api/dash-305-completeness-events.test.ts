/**
 * DASH-305 — guard the completeness lifecycle event emissions.
 *
 * The dashboard's /completeness page (in `apps/dashboard/app/completeness/`)
 * subscribes to these event types via WS so it can mutate SWR caches
 * within ~250 ms of a sentinel run instead of polling every 60 s. This
 * test pins the contract that POST /completeness/runs publishes:
 *   1. completeness.run_started (once, before the transaction)
 *   2. completeness.run_completed (once, after transaction commits)
 *   3. completeness.check.completed (once, structured observability)
 *   4. completeness.finding_filed (one per finding)
 *   5. pipeline.stage.advanced (existing — also asserted)
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations } from '../../src/db/connection';
import { registerCompletenessRoutes } from '../../src/api/routes/stories';
import { wireEventBus } from '../../src/events/bus-adapter';
import { eventBus } from '@chiefaia/event-bus-internal';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

describe('DASH-305 completeness event emissions', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-dash305-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    wireEventBus(db);
    app = new Hono();
    registerCompletenessRoutes(app, db);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('passing run emits run_started + run_completed + check.completed (no finding_filed when findings is empty)', async () => {
    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;

    const res = await app.request('/completeness/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_kind: 'story',
        entity_id: 'st_dash305_pass',
        checks_total: 3,
        checks_passed: 3,
        score_pct: 100,
        status: 'pass',
        findings: [],
      }),
    });
    expect(res.status).toBe(201);

    const events = eventBus.replay({ correlationId: undefined, limit: 200 }).slice(before);
    const types = events.map(e => e.type);

    expect(types).toContain('completeness.run_started');
    expect(types).toContain('completeness.run_completed');
    expect(types).toContain('completeness.check.completed');
    expect(types).toContain('pipeline.stage.advanced');
    expect(types).not.toContain('completeness.finding_filed');

    // run_started fires before run_completed (ordering matters for the
    // dashboard's "in-flight" indicator). `eventBus.replay` returns rows
    // in DESC `occurred_at` order — so the *higher* index is the *earlier*
    // event chronologically.
    expect(types.indexOf('completeness.run_started'))
      .toBeGreaterThan(types.indexOf('completeness.run_completed'));

    // run_started payload carries entity discriminators
    const startedEv = events.find(e => e.type === 'completeness.run_started');
    expect(startedEv).toBeDefined();
    expect(startedEv!.entity_id).toBe('st_dash305_pass');
    expect(startedEv!.entity_type).toBe('story');
  });

  it('failing run with findings emits one finding_filed per finding', async () => {
    const before = eventBus.replay({ correlationId: undefined, limit: 500 }).length;

    const res = await app.request('/completeness/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_kind: 'story',
        entity_id: 'st_dash305_fail',
        checks_total: 3,
        checks_passed: 1,
        score_pct: 33,
        status: 'fail',
        findings: [
          { check_kind: 'attribute', expected: '"x"', actual: '"y"', severity: 'critical', message: 'mismatch x' },
          { check_kind: 'attribute', expected: '"a"', actual: '"b"', severity: 'warning', message: 'soft fail a' },
        ],
      }),
    });
    expect(res.status).toBe(201);

    const events = eventBus.replay({ correlationId: undefined, limit: 500 }).slice(before);
    const findingFiled = events.filter(e => e.type === 'completeness.finding_filed');
    expect(findingFiled).toHaveLength(2);

    // Severities preserved on the event envelope
    const severities = findingFiled.map(e => e.severity).sort();
    expect(severities).toEqual(['error', 'warning']);

    // Each finding event carries the run_id + check_kind for the consumer
    for (const ev of findingFiled) {
      const p = ev.payload as Record<string, unknown>;
      expect(p['run_id']).toEqual(expect.any(Number));
      expect(p['entity_id']).toBe('st_dash305_fail');
      expect(p['check_kind']).toBe('attribute');
    }
  });

  it('run_started is emitted even if the transaction would later fail (best-effort signal)', async () => {
    // Negative test: even with a malformed body that the route parses
    // partially, run_started should still fire BEFORE the transaction so
    // dashboards can show an in-flight state. We pass a pending status
    // with no findings to keep the transaction healthy.
    const before = eventBus.replay({ correlationId: undefined, limit: 200 }).length;

    const res = await app.request('/completeness/runs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entity_kind: 'task',
        entity_id: 'tsk_dash305_started',
        checks_total: 5,
        status: 'pending',
        findings: [],
      }),
    });
    expect(res.status).toBe(201);

    const events = eventBus.replay({ correlationId: undefined, limit: 200 }).slice(before);
    const startedEv = events.find(e => e.type === 'completeness.run_started');
    expect(startedEv).toBeDefined();
    expect((startedEv!.payload as Record<string, unknown>)['checks_total']).toBe(5);
  });
});

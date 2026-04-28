/**
 * GATE-4-04 — guard the /metrics/phase1 contract.
 *
 * The dashboard's Phase-1 metrics panel polls this endpoint to render
 * prompts in flight, prompts by status, bucket placements/min, and
 * average + p50 latency per pipeline stage. All metrics are derived
 * from existing tables (no new state).
 */
import { Hono } from 'hono';
import { resetDb, getDb, runMigrations, getSqliteRaw } from '../../src/db/connection';
import { registerMetricsPhase1Routes } from '../../src/api/routes/metrics-phase1';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

interface MetricsBody {
  windowMinutes: number;
  promptsInFlight: number;
  promptsByStatus: Record<string, number>;
  bucketsCreatedLastWindow: number;
  bucketPlacementsPerMin: number;
  stageLatencyMsAvg: Record<string, number>;
  stageLatencyMsP50: Record<string, number>;
}

describe('GATE-4-04 GET /metrics/phase1', () => {
  let app: Hono;
  let dbPath: string;

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `caia-gate4-metrics-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
    process.env.CONDUCTOR_DB_PATH = dbPath;
    resetDb();
    runMigrations(dbPath);
    const db = getDb(dbPath);
    app = new Hono();
    registerMetricsPhase1Routes(app, db);
  });

  afterEach(() => {
    resetDb();
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    delete process.env.CONDUCTOR_DB_PATH;
  });

  it('returns zeros when there is no Phase-1 traffic yet', async () => {
    const res = await app.request('/metrics/phase1');
    expect(res.status).toBe(200);
    const body = await res.json() as MetricsBody;
    expect(body.windowMinutes).toBe(15);
    expect(body.promptsInFlight).toBe(0);
    expect(body.promptsByStatus).toEqual({});
    expect(body.bucketsCreatedLastWindow).toBe(0);
    expect(body.bucketPlacementsPerMin).toBe(0);
    expect(body.stageLatencyMsAvg).toEqual({});
    expect(body.stageLatencyMsP50).toEqual({});
  });

  it('aggregates prompts, buckets, and stage latencies inside the window', async () => {
    const sqlite = getSqliteRaw();
    const now = new Date().toISOString();

    // Three prompts: one in-flight (po_decomposed), two terminal
    // (ready_for_pickup + failed). promptsInFlight should be 1.
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_a', 'a', now, 'api', 'po_decomposed', 'cor_a', 'h_a');
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_b', 'b', now, 'api', 'ready_for_pickup', 'cor_b', 'h_b');
    sqlite.prepare(
      "INSERT INTO prompts (id, body, received_at, received_via, status, correlation_id, hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('prm_c', 'c', now, 'api', 'failed', 'cor_c', 'h_c');

    // Buckets: one inside the 15min window, one OUTSIDE.
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_recent', 'parallel', null, 'prm_b', Date.now() - 60_000, null, 'open');
    sqlite.prepare(
      "INSERT INTO task_buckets (id, kind, domain_slug, prompt_id, created_at, sequence_index, status) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('tb_old', 'parallel', null, 'prm_b', Date.now() - 3_600_000, null, 'drained');

    // Pipeline stages: 4 transitions for prm_a INSIDE the window with
    // back-filled durations, 1 transition OUTSIDE the window.
    const insertStage = (id: string, prompt: string, stage: string, enteredAt: number, dur: number | null) => sqlite.prepare(
      "INSERT INTO prompt_pipeline_stages (id, prompt_id, stage, entity_kind, entity_id, entered_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, prompt, stage, 'prompt', prompt, enteredAt, dur);

    const baseT = Date.now() - 5 * 60_000;
    insertStage('pps1', 'prm_a', 'ingested',     baseT,                100);
    insertStage('pps2', 'prm_a', 'scaffolded',   baseT + 100,         5_000);
    insertStage('pps3', 'prm_a', 'po_decomposed',baseT + 5_100,       3_000);
    insertStage('pps4', 'prm_a', 'ba_enriched',  baseT + 8_100,        null);
    insertStage('pps_old', 'prm_b', 'ready_for_pickup', Date.now() - 3_600_000, 200);

    const res = await app.request('/metrics/phase1?windowMin=15');
    expect(res.status).toBe(200);
    const body = await res.json() as MetricsBody;

    expect(body.windowMinutes).toBe(15);
    expect(body.promptsByStatus).toEqual({ po_decomposed: 1, ready_for_pickup: 1, failed: 1 });
    expect(body.promptsInFlight).toBe(1);
    expect(body.bucketsCreatedLastWindow).toBe(1);
    expect(body.bucketPlacementsPerMin).toBeCloseTo(1 / 15, 2);
    expect(body.stageLatencyMsAvg).toEqual({ ingested: 100, scaffolded: 5_000, po_decomposed: 3_000 });
    expect(body.stageLatencyMsP50).toEqual({ ingested: 100, scaffolded: 5_000, po_decomposed: 3_000 });
    // The OUTSIDE-window stage row must NOT contribute.
    expect(body.stageLatencyMsAvg.ready_for_pickup).toBeUndefined();
  });

  it('clamps windowMin to [1, 1440]', async () => {
    const r1 = await app.request('/metrics/phase1?windowMin=0');
    const b1 = await r1.json() as MetricsBody;
    expect(b1.windowMinutes).toBe(1);
    const r2 = await app.request('/metrics/phase1?windowMin=99999');
    const b2 = await r2.json() as MetricsBody;
    expect(b2.windowMinutes).toBe(1440);
  });
});

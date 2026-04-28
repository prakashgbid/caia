/**
 * Gate 4 dashboard ↔ Phase-1 E2E acceptance test.
 *
 * Drives a single ad-hoc prompt through the real Phase-1 pipeline
 * (PO → BA → Task Manager → bucket placed) — same code paths the
 * production orchestrator uses — then exercises every Gate-4 dashboard
 * API surface on the Hono app and asserts the responses are exactly
 * what the dashboard's UI consumes:
 *
 *   - GET /prompts/:id/phase1   →  Phase-1 Journey timeline (Batch 1)
 *   - GET /buckets               →  Bucket kanban (Batch 2)
 *   - GET /buckets/:id           →  Bucket detail rail (Batch 2)
 *   - GET /stories/:id/bundle    →  TicketBundleViewer (Batch 3)
 *   - GET /metrics/phase1        →  Phase-1 metrics panel (Batch 4)
 *
 * If this test passes, the dashboard's pages will render the live
 * Phase-1 data correctly. The dashboard pages themselves are pure
 * fetch-and-render of these envelopes — verified by their typecheck
 * and the per-route unit/integration tests in the Gate-4 suite.
 *
 * This is the functional equivalent of a Playwright happy-path: it
 * guarantees the data the UI consumes is correct end-to-end without
 * paying the cost of running a real Next.js process in CI.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../src/db/schema';
import { events, prompts, stories } from '../src/db/schema';
import { eventBus } from '@chiefaia/event-bus-internal';

import { runPOAgent } from '../src/agents/po-agent';
import { runBAAgent } from '../src/agents/ba-agent';
import { runTaskScheduler } from '../src/agents/task-scheduler';
import { advancePipelineStage } from '../src/agents/pipeline-stages';
import { registerPromptsRoutes } from '../src/api/routes/prompts';
import { registerBucketsRoutes } from '../src/api/routes/buckets';
import { registerStoriesRoutes } from '../src/api/routes/stories';
import { registerMetricsPhase1Routes } from '../src/api/routes/metrics-phase1';

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

function nowIso() {
  return new Date().toISOString();
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function wireBusToTestDb(db: ReturnType<typeof createTestDb>) {
  eventBus.wireDb({
    insertEvent: (row) => {
      db.insert(events)
        .values({
          id: row.id,
          type: row.type,
          occurredAt: row.occurred_at,
          actor: row.actor,
          correlationId: row.correlation_id ?? undefined,
          causationId: row.causation_id ?? undefined,
          traceId: row.trace_id ?? undefined,
          spanId: row.span_id ?? undefined,
          entityType: row.entity_type ?? undefined,
          entityId: row.entity_id ?? undefined,
          projectSlug: row.project_slug ?? undefined,
          domainSlugsJson: row.domain_slugs_json,
          payloadJson: row.payload_json,
          metadataJson: row.metadata_json,
          severity: row.severity,
        })
        .run();
    },
    queryEvents: () => [],
  });
}

interface Phase1Body {
  prompt: { id: string; correlationId: string; status: string };
  pipelineStages: Array<{ stage: string }>;
  stories: Array<{ id: string; bucketId: string | null; templateValidationStatus: string }>;
  buckets: Array<{ id: string; kind: string; storyIds: string[] }>;
  agentMessages: Array<{ messageType: string }>;
  phase1Events: Array<{ type: string }>;
}

interface BucketsListBody {
  total: number;
  buckets: Array<{ id: string }>;
  grouped: { sequential: unknown[]; parallel: unknown[] };
}

interface BucketDetailBody {
  bucket: { id: string };
  stories: Array<{ id: string }>;
}

interface BundleBody {
  story: { id: string; templateValidationStatus: string };
  ticket: { scope?: { summary: string }; acceptanceCriteria?: string[]; baEnrichment?: { enrichedBy: string } } | null;
  ticketParseError: string | null;
  prompt: { id: string } | null;
  bucket: { id: string } | null;
}

interface MetricsBody {
  promptsInFlight: number;
  promptsByStatus: Record<string, number>;
  bucketsCreatedLastWindow: number;
  stageLatencyMsAvg: Record<string, number>;
}

describe('Gate 4 dashboard ↔ Phase-1 E2E', () => {
  it('a real prompt drives every dashboard surface end-to-end', async () => {
    const db = createTestDb();
    wireBusToTestDb(db);

    // ─── 1. Build the Hono app the dashboard talks to ─────────────────
    const app = new Hono();
    registerPromptsRoutes(app, db);
    registerBucketsRoutes(app, db);
    registerStoriesRoutes(app, db);
    registerMetricsPhase1Routes(app, db);

    // ─── 2. Drive the Phase-1 pipeline ────────────────────────────────
    // We use the same agent functions the production POST /prompts
    // route would invoke. The production scaffolder's setTimeout-based
    // chain is bypassed here so the test stays deterministic.
    const promptId = 'prm_gate4_e2e';
    const correlationId = 'cor_gate4_e2e';
    db.insert(prompts)
      .values({
        id: promptId,
        body: 'add user login with Google OAuth',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId,
        hash: 'h_gate4_e2e',
        status: 'received',
      })
      .run();

    advancePipelineStage({ promptId, stage: 'ingested', correlationId }, db);
    advancePipelineStage({ promptId, stage: 'scaffolded', correlationId }, db);
    await runPOAgent(
      { promptId, promptText: 'add user login with Google OAuth', projectId: null, correlationId },
      db,
    );
    await runBAAgent(
      {
        promptId,
        correlationId,
        consultants: ['ea-agent', 'security-agent', 'testing-agent', 'release-agent'],
        collabTimeoutMs: 1_000,
      },
      db,
    );
    await runTaskScheduler({ promptId, correlationId }, db);

    // ─── 3. /prompts/:id/phase1 — Journey page (Batch 1) ───────────────
    const phase1Res = await app.request(`/prompts/${promptId}/phase1`);
    expect(phase1Res.status).toBe(200);
    const phase1 = await phase1Res.json() as Phase1Body;

    // Prompt header
    expect(phase1.prompt.id).toBe(promptId);
    expect(phase1.prompt.correlationId).toBe(correlationId);
    expect(phase1.prompt.status).toBe('ready_for_pickup');
    // All 6 Phase-1 stages have rows
    const seen = phase1.pipelineStages.map((s) => s.stage);
    for (const required of ['ingested', 'scaffolded', 'po_decomposed', 'ba_enriched', 'bucket_placed', 'ready_for_pickup']) {
      expect(seen).toContain(required);
    }
    // Stories produced + at least one validated
    expect(phase1.stories.length).toBeGreaterThan(0);
    expect(phase1.stories.some((s) => s.templateValidationStatus === 'valid')).toBe(true);
    // Buckets created and back-linked to stories
    expect(phase1.buckets.length).toBeGreaterThan(0);
    expect(phase1.buckets.some((b) => b.storyIds.length > 0)).toBe(true);
    // BA collab thread populated
    expect(phase1.agentMessages.some((m) => m.messageType === 'input-requested')).toBe(true);
    expect(phase1.agentMessages.some((m) => m.messageType === 'input-received')).toBe(true);
    // Phase-1 events filtered to this correlation
    const evTypes = phase1.phase1Events.map((e) => e.type);
    expect(evTypes).toContain('po-agent.decomposition.complete');
    expect(evTypes).toContain('ba-agent.enrichment.complete');
    expect(evTypes).toContain('task-scheduler.bucket-placed');

    // ─── 4. /buckets — Bucket kanban (Batch 2) ────────────────────────
    const bucketsRes = await app.request('/buckets');
    expect(bucketsRes.status).toBe(200);
    const bucketsBody = await bucketsRes.json() as BucketsListBody;
    expect(bucketsBody.total).toBeGreaterThan(0);
    expect(bucketsBody.grouped.parallel.length + bucketsBody.grouped.sequential.length)
      .toBe(bucketsBody.total);
    // Filter by promptId returns only this prompt's buckets.
    const filteredRes = await app.request(`/buckets?promptId=${promptId}`);
    const filteredBody = await filteredRes.json() as BucketsListBody;
    expect(filteredBody.total).toBe(bucketsBody.total);

    // ─── 5. /buckets/:id — Detail rail (Batch 2) ──────────────────────
    const sampleBucketId = bucketsBody.buckets[0].id;
    const bucketDetailRes = await app.request(`/buckets/${sampleBucketId}`);
    expect(bucketDetailRes.status).toBe(200);
    const bucketDetail = await bucketDetailRes.json() as BucketDetailBody;
    expect(bucketDetail.bucket.id).toBe(sampleBucketId);
    expect(bucketDetail.stories.length).toBeGreaterThan(0);

    // ─── 6. /stories/:id/bundle — TicketBundleViewer (Batch 3) ────────
    const validStory = phase1.stories.find((s) => s.templateValidationStatus === 'valid')!;
    const bundleRes = await app.request(`/stories/${validStory.id}/bundle`);
    expect(bundleRes.status).toBe(200);
    const bundle = await bundleRes.json() as BundleBody;
    expect(bundle.story.id).toBe(validStory.id);
    expect(bundle.story.templateValidationStatus).toBe('valid');
    expect(bundle.ticket).not.toBeNull();
    expect(bundle.ticketParseError).toBeNull();
    expect(bundle.ticket?.scope?.summary).toBeTruthy();
    expect(bundle.ticket?.acceptanceCriteria?.length ?? 0).toBeGreaterThanOrEqual(3);
    expect(bundle.ticket?.baEnrichment?.enrichedBy).toBe('ba-agent');
    expect(bundle.prompt?.id).toBe(promptId);
    expect(bundle.bucket?.id).toBeTruthy();

    // ─── 7. /metrics/phase1 — Metrics panel (Batch 4) ─────────────────
    const metricsRes = await app.request('/metrics/phase1');
    expect(metricsRes.status).toBe(200);
    const metrics = await metricsRes.json() as MetricsBody;
    expect(metrics.promptsByStatus.ready_for_pickup).toBe(1);
    expect(metrics.promptsInFlight).toBe(0);
    expect(metrics.bucketsCreatedLastWindow).toBeGreaterThan(0);
    // Latency averages must include the stages this prompt advanced through.
    expect(metrics.stageLatencyMsAvg.ingested).toBeGreaterThanOrEqual(0);
    expect(metrics.stageLatencyMsAvg.po_decomposed).toBeGreaterThanOrEqual(0);

    // ─── 8. Sanity: terminal status mirrored on prompts.status ────────
    const finalPrompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    expect(finalPrompt!.status).toBe('ready_for_pickup');

    // ─── 9. Bundle from the stories table — every valid story has the
    //         template version and a bucket id (executor pick-up gate) ─
    const validStories = db.select().from(stories).where(eq(stories.rootPromptId, promptId)).all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(validStories.length).toBeGreaterThan(0);
    for (const s of validStories) {
      expect(s.templateVersion).toBe('v1');
      expect(s.bucketId).toBeTruthy();
    }
  });
});

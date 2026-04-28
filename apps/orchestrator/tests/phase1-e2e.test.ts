/**
 * Phase 1 end-to-end acceptance test — the verification gate for Gate 3.
 *
 * Drives a single ad-hoc prompt all the way through the pipeline:
 *   1. POST equivalent: insert into `prompts` table.
 *   2. Run the scaffolder, PO agent, BA agent, and task scheduler in
 *      sequence (the production setTimeout chain replaced with deterministic
 *      awaits so the test is fast and stable).
 *   3. Assert every handoff:
 *      - Pipeline stages progress: ingested → scaffolded → po_decomposed
 *        → ba_enriched → bucket_placed → ready_for_pickup.
 *      - Correlation id is consistent across all stages.
 *      - Required events fired in order.
 *      - Stories carry validated TicketTemplateV1 payloads.
 *      - Stories are linked to a task_buckets row.
 *      - getTicketBundle returns the self-contained payload an executor
 *        would consume.
 *
 * If this test fails, Gate 3 has regressed.
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, asc } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../src/db/schema';
import {
  events,
  prompts,
  promptPipelineStages,
  stories,
  taskBuckets,
} from '../src/db/schema';
import { eventBus } from '@chiefaia/event-bus-internal';
import {
  TicketTemplateV1Schema,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';

import { runPOAgent } from '../src/agents/po-agent';
import { runBAAgent } from '../src/agents/ba-agent';
import { runTaskScheduler } from '../src/agents/task-scheduler';
import { advancePipelineStage } from '../src/agents/pipeline-stages';
import { getTicketBundle } from '../src/api/ticket-bundle';

const MIGRATIONS_DIR = path.join(__dirname, '../src/db/migrations');

function nowIso() {
  return new Date().toISOString();
}

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return { db, sqlite };
}

/**
 * Wire the singleton event bus to the test's events table so every
 * publish writes a row we can replay/inspect. Use a minimal adapter — the
 * production wireEventBus() pulls in too much machinery.
 */
function wireBusToTestDb(db: ReturnType<typeof createTestDb>['db']) {
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

describe('Phase 1 pipeline E2E', () => {
  it('drives a prompt through every stage and produces a valid, placed ticket', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    // ─── 1. POST /prompts equivalent ──────────────────────────────────────
    const promptId = 'prm_e2e_phase1';
    const correlationId = 'cor_e2e_phase1';
    db.insert(prompts)
      .values({
        id: promptId,
        body: 'implement a user login feature with Google OAuth',
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId,
        hash: 'hash_e2e',
        status: 'received',
      })
      .run();
    advancePipelineStage(
      { promptId, stage: 'ingested', correlationId },
      db,
    );

    // ─── 2. Drive the chain ──────────────────────────────────────────────
    // The production scaffolder fires a setTimeout(...,5_000) chain we
    // can't await inside a unit test; instead we mark `scaffolded` directly
    // and call each downstream agent synchronously so the test is
    // deterministic and finishes inside Jest's default budget.
    advancePipelineStage(
      { promptId, stage: 'scaffolded', correlationId },
      db,
    );
    await runPOAgent(
      {
        promptId,
        promptText: 'implement a user login feature with Google OAuth',
        projectId: null,
        correlationId,
      },
      db,
    );
    await runBAAgent(
      {
        promptId,
        correlationId,
        // Restrict consultants to keep the test fast and stable.
        consultants: ['ea-agent', 'security-agent', 'testing-agent', 'release-agent'],
        collabTimeoutMs: 1_000,
      },
      db,
    );
    await runTaskScheduler({ promptId, correlationId }, db);

    // ─── 3. Assert pipeline stage progression ────────────────────────────
    const stageRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, promptId))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    const seenStages = stageRows.map((s) => s.stage);
    for (const required of [
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ba_enriched',
      'bucket_placed',
      'ready_for_pickup',
    ]) {
      expect(seenStages).toContain(required);
    }

    // Final prompts.status must reflect terminal stage.
    const finalPrompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    expect(finalPrompt!.status).toBe('ready_for_pickup');

    // ─── 4. Assert events fired with consistent correlation_id ──────────
    const allEvents = db
      .select()
      .from(events)
      .orderBy(asc(events.occurredAt))
      .all();
    const eventTypes = new Set(allEvents.map((e) => e.type));

    for (const required of [
      'po-agent.decomposition.complete',
      'ba-agent.input-requested',
      'ba-agent.input-received',
      'ba-agent.enrichment.complete',
      'task-scheduler.scheduling.complete',
      'ticket.draft',
      'ticket.po-decomposed',
      'ticket.ba-enriching',
      'ticket.ba-complete',
    ]) {
      if (!eventTypes.has(required)) {
        // Surface what we did see to make the diff actionable.
        const seen = [...eventTypes].sort().join(', ');
        throw new Error(`required event ${required} not fired. Saw: ${seen}`);
      }
    }
    // task-scheduler.bucket-placed and ticket.ready-for-pickup only fire
    // when stories were enriched and placed into a bucket — assert
    // conditionally below when we know placements occurred.

    // The pipeline-stage transitions all carry the same correlation id.
    const correlatedStageEvents = allEvents.filter(
      (e) => e.type === 'pipeline.stage.advanced' && e.correlationId === correlationId,
    );
    expect(correlatedStageEvents.length).toBeGreaterThanOrEqual(5);

    // BA collaboration events all carry a sub-correlation that prefix-matches
    // the prompt's correlation id (BA uses `${correlationId}::${storyId}`).
    const baInputRequested = allEvents.filter((e) => e.type === 'ba-agent.input-requested');
    expect(baInputRequested.length).toBeGreaterThan(0);
    for (const ev of baInputRequested) {
      expect(ev.correlationId?.startsWith(correlationId)).toBe(true);
    }

    // ─── 5. Assert stories enriched with valid template payloads ────────
    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    expect(storyRows.length).toBeGreaterThan(0);

    let validCount = 0;
    for (const s of storyRows) {
      expect(s.templateVersion).toBe('v1');
      expect(['valid', 'invalid', 'pending']).toContain(s.templateValidationStatus);
      // The pipeline must produce at least one validated ticket.
      if (s.templateValidationStatus === 'valid') {
        validCount++;
        const ticket = JSON.parse(s.agentContributionsJson);
        const parsed = TicketTemplateV1Schema.safeParse(ticket);
        expect(parsed.success).toBe(true);
        if (parsed.success) {
          const t: TicketTemplateV1 = parsed.data;
          expect(t.acceptanceCriteria.length).toBeGreaterThanOrEqual(3);
          expect(t.scope.summary).toBeTruthy();
          expect(t.baEnrichment?.enrichedBy).toBe('ba-agent');
          // At least one consultant section must be populated.
          expect(Object.keys(t.agentSections).length).toBeGreaterThan(0);
        }
      }
    }
    expect(validCount).toBeGreaterThan(0);

    // ─── 6. Assert bucket placement happened ────────────────────────────
    const bucketsForPrompt = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.promptId, promptId))
      .all();
    expect(bucketsForPrompt.length).toBeGreaterThan(0);
    for (const s of storyRows) {
      expect(s.bucketId).toBeTruthy();
    }

    // Bucket-related events must have fired now that placements exist.
    expect(eventTypes.has('task-scheduler.bucket-placed')).toBe(true);
    expect(eventTypes.has('ticket.ready-for-pickup')).toBe(true);
    expect(seenStages).toContain('bucket_placed');
    expect(seenStages).toContain('ready_for_pickup');

    // ─── 7. getTicketBundle returns a self-contained payload ────────────
    const sampleStoryId = storyRows[0]!.id;
    const bundle = getTicketBundle(db, sampleStoryId);
    expect(bundle).toBeTruthy();
    expect(bundle!.story.id).toBe(sampleStoryId);
    expect(bundle!.prompt?.id).toBe(promptId);
    expect(bundle!.bucket?.id).toBeTruthy();
    if (bundle!.story.templateValidationStatus === 'valid') {
      expect(bundle!.ticket).not.toBeNull();
      expect(bundle!.ticketParseError).toBeNull();
    }
  });
});

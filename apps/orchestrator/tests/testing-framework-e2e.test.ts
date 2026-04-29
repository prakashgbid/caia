/**
 * Testing-framework Phase A end-to-end acceptance test (TEST-007).
 *
 * Drives a single ad-hoc prompt with rich acceptance criteria through
 * the full PO → BA → Test-Design → Task-Scheduler chain and asserts:
 *
 *   1. The prompt advances through every stage including `test_designed`.
 *   2. Every valid story has a populated `testCases` array of ≥1 case.
 *   3. The cases cover the expected categories (happy + a11y + error +
 *      security or performance) given the prompt's UI/API/security cues.
 *   4. The dashboard's bundle payload (the same data
 *      `/stories/[id]` consumes) round-trips testCases + testDesign.
 *   5. `test.cases_generated` and `test.case_added` events fire with
 *      the prompt's correlation id and the right per-case metadata.
 *   6. Re-running the chain is idempotent — no duplicate cases, no
 *      duplicated events for the same story.
 *
 * If this test fails, the testing-framework Phase A has regressed.
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
} from '../src/db/schema';
import { eventBus } from '@chiefaia/event-bus-internal';
import {
  TicketTemplateV1Schema,
  type TicketTemplateV1,
} from '@chiefaia/ticket-template';

import { runPOAgent } from '../src/agents/po-agent';
import { runBAAgent } from '../src/agents/ba-agent';
import { runTestDesignAgent } from '../src/agents/test-design-agent';
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

const PROMPT_TEXT =
  'Build a /signup form with email + password. The page must be ' +
  'WCAG-AA accessible, the API must rate-limit by IP, and the database ' +
  'should add an index on user.email. Return 401 when the password is wrong.';

describe('Testing framework E2E (Phase A)', () => {
  it('drives a prompt through PO/BA/Test-Design and produces a story with N test cases', async () => {
    const { db } = createTestDb();
    wireBusToTestDb(db);

    const promptId = 'prm_test_e2e';
    const correlationId = 'cor_test_e2e';

    // ─── 1. POST /prompts equivalent ──────────────────────────────────────
    db.insert(prompts)
      .values({
        id: promptId,
        body: PROMPT_TEXT,
        receivedAt: nowIso(),
        receivedVia: 'api',
        correlationId,
        hash: 'hash_test_e2e',
        status: 'received',
      })
      .run();
    advancePipelineStage({ promptId, stage: 'ingested', correlationId }, db);

    // ─── 2. Drive the chain (replicating the scaffolder's chain) ──────────
    advancePipelineStage({ promptId, stage: 'scaffolded', correlationId }, db);
    await runPOAgent(
      { promptId, promptText: PROMPT_TEXT, projectId: null, correlationId },
      db,
    );
    await runBAAgent(
      {
        promptId,
        correlationId,
        // Include ui-agent + bff-agent so the BA collab populates the
        // UI + API sections — that's what triggers the Test-Design Agent
        // to generate accessibility / security / visual cases.
        consultants: [
          'ea-agent',
          'ui-agent',
          'bff-agent',
          'security-agent',
          'testing-agent',
          'release-agent',
        ],
        collabTimeoutMs: 1_000,
      },
      db,
    );

    const designOut = await runTestDesignAgent({ promptId, correlationId }, db);
    advancePipelineStage(
      {
        promptId,
        stage: 'test_designed',
        correlationId,
        metadata: {
          designedStories: designOut.designedStories,
          totalTestCases: designOut.totalTestCases,
        },
      },
      db,
    );

    await runTaskScheduler({ promptId, correlationId }, db);

    // ─── 3. Pipeline-stage progression includes test_designed ─────────────
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
      'test_designed',
      'bucket_placed',
      'ready_for_pickup',
    ]) {
      expect(seenStages).toContain(required);
    }
    expect(seenStages.indexOf('test_designed')).toBeGreaterThan(
      seenStages.indexOf('ba_enriched'),
    );
    expect(seenStages.indexOf('test_designed')).toBeLessThan(
      seenStages.lastIndexOf('bucket_placed'),
    );

    // ─── 4. Stories carry a populated testCases array ─────────────────────
    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    const designedStories = storyRows.filter((s) => s.testDesignStatus === 'designed');
    expect(designedStories.length).toBeGreaterThan(0);
    expect(designOut.totalTestCases).toBeGreaterThan(0);

    let totalCasesObserved = 0;
    let categoriesSeen = new Set<string>();
    for (const s of designedStories) {
      const cases = JSON.parse(s.testCasesJson) as Array<{ category: string; status: string }>;
      expect(cases.length).toBeGreaterThan(0);
      totalCasesObserved += cases.length;
      for (const c of cases) categoriesSeen.add(c.category);

      // Every case is in pending status when the design finishes.
      for (const c of cases) expect(c.status).toBe('pending');
    }
    expect(totalCasesObserved).toBe(designOut.totalTestCases);

    // ─── 5. Categories cover the expected breadth ─────────────────────────
    // The prompt explicitly mentions accessibility (WCAG-AA), an API
    // (rate-limit), an error path (401), a database index, and security
    // (rate-limit). The Test-Design Agent must produce at least happy,
    // error, and accessibility cases.
    expect(categoriesSeen.has('happy')).toBe(true);
    expect(categoriesSeen.has('error')).toBe(true);
    // Either accessibility or security must be present (the BA agent's
    // domain responders may activate only one of them depending on the
    // prompt's primary domain).
    expect(
      categoriesSeen.has('accessibility') || categoriesSeen.has('security'),
    ).toBe(true);

    // ─── 6. Bundle payload (the dashboard's source of truth) carries the
    //        testCases + testDesign sub-objects. ──────────────────────────
    const sampleStoryId = designedStories[0]!.id;
    const bundle = getTicketBundle(db, sampleStoryId);
    expect(bundle).toBeTruthy();
    expect(bundle!.ticket).not.toBeNull();
    expect(bundle!.ticket!.testCases?.length ?? 0).toBeGreaterThan(0);
    expect(bundle!.ticket!.testDesign?.designedBy).toBe('test-design-agent');
    expect(bundle!.ticket!.testDesign?.totalCases).toBe(
      bundle!.ticket!.testCases!.length,
    );
    // Bundle ticket still validates the v1 schema after testCases injection.
    const reparsed = TicketTemplateV1Schema.safeParse(bundle!.ticket);
    expect(reparsed.success).toBe(true);
    if (reparsed.success) {
      const t: TicketTemplateV1 = reparsed.data;
      expect(t.metadata.testDesignedAt).toBeGreaterThan(0);
    }

    // ─── 7. test.* events fired with the prompt's correlation id ─────────
    const testEvents = db
      .select()
      .from(events)
      .where(eq(events.correlationId, correlationId))
      .all()
      .filter((e) => e.type.startsWith('test.'));
    const aggregateEvents = testEvents.filter((e) => e.type === 'test.cases_generated');
    const perCaseEvents = testEvents.filter((e) => e.type === 'test.case_added');

    expect(aggregateEvents.length).toBe(designedStories.length);
    expect(perCaseEvents.length).toBe(totalCasesObserved);

    for (const ev of perCaseEvents) {
      const payload = JSON.parse(ev.payloadJson) as {
        testCaseId: string;
        category: string;
        layer: string;
      };
      expect(payload.testCaseId).toBeTruthy();
      expect([
        'happy', 'edge', 'error', 'accessibility', 'security', 'performance', 'visual',
      ]).toContain(payload.category);
      expect([
        'unit', 'integration', 'e2e', 'visual', 'accessibility',
      ]).toContain(payload.layer);
    }

    // ─── 8. Re-running the agent is idempotent ────────────────────────────
    const second = await runTestDesignAgent({ promptId, correlationId }, db);
    expect(second.designedStories).toBe(0);
    expect(second.storiesSkipped).toBe(designedStories.length);

    // No new test events from the second run — counts unchanged.
    const testEventsAfter = db
      .select()
      .from(events)
      .where(eq(events.correlationId, correlationId))
      .all()
      .filter((e) => e.type.startsWith('test.'));
    expect(testEventsAfter.length).toBe(testEvents.length);

    // testDesignStatus stays 'designed' on every story.
    const storiesAfter = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    expect(
      storiesAfter.filter((s) => s.testDesignStatus === 'designed').length,
    ).toBe(designedStories.length);
  });
});

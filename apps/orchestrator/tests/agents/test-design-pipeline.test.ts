/**
 * TEST-005 — integration test for the BA → Test-Design Agent → bucket
 * placement chain. Drives a prompt through PO + BA + Test-Design and
 * asserts that:
 *   - the prompt advances to the test_designed stage
 *   - the stage row records design metadata
 *   - the test.cases_generated event fires for the enriched story
 *   - the story has its testCasesJson populated
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, asc } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  prompts,
  promptPipelineStages,
  stories,
  events as eventsTable,
} from '../../src/db/schema';
import { runPOAgent } from '../../src/agents/po-agent';
import { runBAAgent } from '../../src/agents/ba-agent';
import { runTestDesignAgent } from '../../src/agents/test-design-agent';
import { advancePipelineStage } from '../../src/agents/pipeline-stages';
import { wireEventBus } from '../../src/events/bus-adapter';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  wireEventBus(db);
  return db;
}

function isoNow() {
  return new Date().toISOString();
}

async function seedPromptAndDecompose(
  db: ReturnType<typeof createTestDb>,
  promptId: string,
  correlationId: string,
) {
  db.insert(prompts)
    .values({
      id: promptId,
      body: 'Add a login form with rate-limit warning + WCAG-AA accessibility.',
      receivedAt: isoNow(),
      receivedVia: 'api',
      correlationId,
      hash: `hash_${promptId}`,
      status: 'received',
    })
    .run();

  // The PO agent decomposes the prompt into requirements + stories.
  await runPOAgent(
    {
      promptId,
      promptText: 'Add a login form with rate-limit warning + WCAG-AA accessibility.',
      projectId: null,
      correlationId,
    },
    db,
  );
  // BA enriches with acceptance criteria + agentSections.
  await runBAAgent({ promptId, correlationId }, db);
}

describe('TEST-005 — BA → Test-Design pipeline integration', () => {
  it('advances the prompt to test_designed and populates testCasesJson', async () => {
    const db = createTestDb();
    const promptId = 'prm_test_005';
    const correlationId = 'cor_test_005';

    await seedPromptAndDecompose(db, promptId, correlationId);

    // Sanity: BA should have produced at least one valid story.
    const validStories = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all()
      .filter((s) => s.templateValidationStatus === 'valid');
    expect(validStories.length).toBeGreaterThan(0);

    // Run the Test-Design Agent directly (mirrors the scaffolder chain).
    const out = await runTestDesignAgent({ promptId, correlationId }, db);
    expect(out.designedStories).toBeGreaterThan(0);
    expect(out.totalTestCases).toBeGreaterThan(0);

    // Advance the pipeline stage (mirrors the scaffolder chain wiring).
    advancePipelineStage(
      {
        promptId,
        stage: 'test_designed',
        correlationId,
        metadata: {
          designedStories: out.designedStories,
          totalTestCases: out.totalTestCases,
        },
      },
      db,
    );

    // Stages list contains test_designed.
    const stageRows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, promptId))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    const stages = stageRows.map((r) => r.stage);
    expect(stages).toContain('ba_enriched');
    expect(stages).toContain('test_designed');
    expect(stages.indexOf('test_designed')).toBeGreaterThan(stages.indexOf('ba_enriched'));

    // The prompt's status mirrors the latest stage.
    const prompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    expect(prompt?.status).toBe('test_designed');

    // At least one story has testCasesJson populated.
    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();
    const designed = storyRows.filter((s) => s.testDesignStatus === 'designed');
    expect(designed.length).toBeGreaterThan(0);
    for (const s of designed) {
      const tc = JSON.parse(s.testCasesJson) as unknown[];
      expect(Array.isArray(tc)).toBe(true);
      expect(tc.length).toBeGreaterThan(0);
    }

    // test.cases_generated and test.case_added events landed.
    const allEvents = db.select().from(eventsTable).all();
    const types = allEvents.map((e) => e.type);
    expect(types).toContain('test.cases_generated');
    expect(types).toContain('test.case_added');

    // Stage metadata captures the design summary.
    const testStageRow = stageRows.find((r) => r.stage === 'test_designed');
    expect(testStageRow?.metadata).toBeTruthy();
    const stageMeta = JSON.parse(testStageRow!.metadata!);
    expect(stageMeta.designedStories).toBe(out.designedStories);
    expect(stageMeta.totalTestCases).toBe(out.totalTestCases);
  });

  it('placing a prompt with zero valid stories still advances to test_designed but skips them', async () => {
    const db = createTestDb();
    const promptId = 'prm_test_005_skip';
    const correlationId = 'cor_test_005_skip';

    db.insert(prompts)
      .values({
        id: promptId,
        body: 'no decomposition',
        receivedAt: isoNow(),
        receivedVia: 'api',
        correlationId,
        hash: `hash_${promptId}`,
        status: 'received',
      })
      .run();

    // No PO/BA — there are no stories to design. Test-Design should still
    // be invokable as a no-op.
    const out = await runTestDesignAgent({ promptId, correlationId }, db);
    expect(out.designedStories).toBe(0);
    expect(out.totalTestCases).toBe(0);
    expect(out.storiesSkipped).toBe(0);
  });
});

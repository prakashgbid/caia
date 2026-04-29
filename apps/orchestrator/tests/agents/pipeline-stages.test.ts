/**
 * Behavioural tests for the pipeline-stage advancement helper. Verifies
 * that each call:
 *   - inserts a row into prompt_pipeline_stages
 *   - mirrors the stage onto prompts.status
 *   - back-fills durationMs on the previous row
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq, asc } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { promptPipelineStages, prompts } from '../../src/db/schema';
import {
  PIPELINE_STAGE_ORDER,
  STAGE_BA_ENRICHED,
  STAGE_BUCKET_PLACED,
  STAGE_READY_FOR_PICKUP,
  STAGE_TEST_DESIGNED,
  STAGE_VALIDATED,
  advancePipelineStage,
  stageIndex,
} from '../../src/agents/pipeline-stages';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function nowIso() {
  return new Date().toISOString();
}

function seedPrompt(db: ReturnType<typeof createTestDb>, id: string) {
  db.insert(prompts)
    .values({
      id,
      body: 'thing',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: `cor_${id}`,
      hash: `hash_${id}`,
      status: 'received',
    })
    .run();
}

describe('PIPELINE_STAGE_ORDER', () => {
  it('locks the canonical Phase-1 + Phase-A progression', () => {
    expect([...PIPELINE_STAGE_ORDER]).toEqual([
      'received',
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ea_classified',
      'ba_enriched',
      'validated',
      'test_designed',
      'bucket_placed',
      'ready_for_pickup',
    ]);
  });

  it('places `validated` strictly after `ba_enriched` and before `test_designed`', () => {
    // VAL-002: the Validator gate sits between BA and Testing.
    expect(stageIndex('ba_enriched')).toBeLessThan(stageIndex('validated'));
    expect(stageIndex('validated')).toBeLessThan(stageIndex('test_designed'));
  });

  it('places every Phase-A stage strictly before bucket_placed', () => {
    // Validator + Testing must complete before Task Manager places the
    // ticket into a bucket.
    for (const stage of ['validated', 'test_designed'] as const) {
      expect(stageIndex(stage)).toBeLessThan(stageIndex('bucket_placed'));
    }
  });

  it('exposes named stage constants matching their string values', () => {
    expect(STAGE_BA_ENRICHED).toBe('ba_enriched');
    expect(STAGE_VALIDATED).toBe('validated');
    expect(STAGE_TEST_DESIGNED).toBe('test_designed');
    expect(STAGE_BUCKET_PLACED).toBe('bucket_placed');
    expect(STAGE_READY_FOR_PICKUP).toBe('ready_for_pickup');
  });

  it('stageIndex returns -1 for unknown stages', () => {
    expect(stageIndex('not_a_stage' as never)).toBe(-1);
  });
});

describe('advancePipelineStage', () => {
  it('inserts a new row and mirrors the stage onto prompts.status', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_a');

    advancePipelineStage(
      { promptId: 'prm_a', stage: 'po_decomposed', correlationId: 'cor_a' },
      db,
    );

    const rows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_a'))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stage).toBe('po_decomposed');
    expect(rows[0]!.entityKind).toBe('prompt');
    expect(rows[0]!.entityId).toBe('prm_a');

    const promptRow = db
      .select()
      .from(prompts)
      .where(eq(prompts.id, 'prm_a'))
      .get();
    expect(promptRow!.status).toBe('po_decomposed');
  });

  it('back-fills durationMs on the previous row when a new stage advances', async () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_b');

    advancePipelineStage(
      { promptId: 'prm_b', stage: 'ingested', correlationId: 'cor_b' },
      db,
    );

    // Wait a hair so the second stage's enteredAt is after the first.
    await new Promise((r) => setTimeout(r, 5));

    advancePipelineStage(
      { promptId: 'prm_b', stage: 'scaffolded', correlationId: 'cor_b' },
      db,
    );

    const rows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_b'))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.stage).toBe('ingested');
    expect(rows[1]!.stage).toBe('scaffolded');
    // Previous row gets durationMs filled.
    expect(rows[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('persists supplied metadata as JSON', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_meta');
    advancePipelineStage(
      {
        promptId: 'prm_meta',
        stage: 'ba_enriched',
        correlationId: 'cor_meta',
        metadata: { ticketsValid: 3, ticketsInvalid: 0 },
      },
      db,
    );
    const row = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_meta'))
      .get();
    expect(row!.metadata).toBeTruthy();
    const parsed = JSON.parse(row!.metadata!);
    expect(parsed.ticketsValid).toBe(3);
  });

  it('progresses a prompt through every Phase-1 stage', () => {
    const db = createTestDb();
    seedPrompt(db, 'prm_full');
    for (const stage of [
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ba_enriched',
      'bucket_placed',
      'ready_for_pickup',
    ] as const) {
      advancePipelineStage(
        { promptId: 'prm_full', stage, correlationId: 'cor_full' },
        db,
      );
    }
    const rows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_full'))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    expect(rows.map((r) => r.stage)).toEqual([
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ba_enriched',
      'bucket_placed',
      'ready_for_pickup',
    ]);
    const promptRow = db
      .select()
      .from(prompts)
      .where(eq(prompts.id, 'prm_full'))
      .get();
    expect(promptRow!.status).toBe('ready_for_pickup');
  });

  it('progresses a prompt through the full Phase-1 + Phase-A sequence (incl. validated + test_designed)', () => {
    // VAL-002: end-to-end traversal that includes the new Validator and
    // Testing stages — once VAL-005 + TEST-### wire them up, this is the
    // shape every prompt will follow.
    const db = createTestDb();
    seedPrompt(db, 'prm_phaseA');
    for (const stage of [
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ea_classified',
      'ba_enriched',
      'validated',
      'test_designed',
      'bucket_placed',
      'ready_for_pickup',
    ] as const) {
      advancePipelineStage(
        { promptId: 'prm_phaseA', stage, correlationId: 'cor_phaseA' },
        db,
      );
    }
    const rows = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_phaseA'))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();
    expect(rows.map((r) => r.stage)).toEqual([
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ea_classified',
      'ba_enriched',
      'validated',
      'test_designed',
      'bucket_placed',
      'ready_for_pickup',
    ]);
    const promptRow = db
      .select()
      .from(prompts)
      .where(eq(prompts.id, 'prm_phaseA'))
      .get();
    expect(promptRow!.status).toBe('ready_for_pickup');
  });

  it('records `validated` with attemptNumber metadata when Validator advances', () => {
    // The Validator agent (VAL-004) attaches attemptNumber + score to its
    // metadata so the dashboard can display retry history. This test
    // verifies that the helper correctly persists arbitrary metadata.
    const db = createTestDb();
    seedPrompt(db, 'prm_val');
    advancePipelineStage(
      {
        promptId: 'prm_val',
        stage: STAGE_VALIDATED,
        correlationId: 'cor_val',
        metadata: { attemptNumber: 2, score: 87, judgeProvider: 'local' },
      },
      db,
    );
    const row = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, 'prm_val'))
      .get();
    expect(row!.stage).toBe('validated');
    const meta = JSON.parse(row!.metadata!);
    expect(meta.attemptNumber).toBe(2);
    expect(meta.score).toBe(87);
    expect(meta.judgeProvider).toBe('local');
  });
});

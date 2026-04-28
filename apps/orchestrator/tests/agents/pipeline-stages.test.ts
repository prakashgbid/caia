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
  advancePipelineStage,
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
  it('locks the canonical Phase-1 progression', () => {
    expect([...PIPELINE_STAGE_ORDER]).toEqual([
      'received',
      'ingested',
      'scaffolded',
      'po_decomposed',
      'ba_enriched',
      'bucket_placed',
      'ready_for_pickup',
    ]);
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
});

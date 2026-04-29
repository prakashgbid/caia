/**
 * VAL-003 — round-trip test for the validation_report column + companion
 * status / attempts / last_validated_at fields added by migration 0027.
 *
 * Verifies:
 *   - the migration runs cleanly on a fresh DB
 *   - the new columns are reachable via the drizzle schema
 *   - round-tripping a structured ValidationReport JSON preserves fidelity
 *   - the indexes covering bucket-placer ready-pool queries exist
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { stories, prompts } from '../../src/db/schema';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function nowIso() {
  return new Date().toISOString();
}

function setupDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  db.insert(prompts)
    .values({
      id: 'prm_val_test',
      body: 'test prompt',
      receivedAt: nowIso(),
      receivedVia: 'api',
      correlationId: 'cor_val_test',
      hash: 'hash_val_test',
      status: 'received',
    })
    .run();

  db.insert(stories)
    .values({
      id: 'stry_val_test',
      title: 'Test story',
      kind: 'story',
      createdAt: nowIso(),
      rootPromptId: 'prm_val_test',
    })
    .run();

  return { db, sqlite };
}

describe('migration 0027 — validation_report column', () => {
  it('applies cleanly and exposes default values on existing stories', () => {
    const { db } = setupDb();
    const row = db.select().from(stories).where(eq(stories.id, 'stry_val_test')).get();

    expect(row).toBeTruthy();
    expect(row!.validationReport).toBeNull();
    expect(row!.validationStatus).toBe('pending');
    expect(row!.validationAttempts).toBe(0);
    expect(row!.lastValidatedAt).toBeNull();
  });

  it('round-trips a structured ValidationReport JSON without loss', () => {
    const { db } = setupDb();
    const report = {
      rubricVersion: 'v1',
      ranAt: 1777800000123,
      durationMs: 2340,
      judgeProvider: 'local',
      judgeModelTouchpoints: ['qwen2.5-coder:7b'],
      passed: true,
      score: 91,
      nextAction: 'proceed',
      attemptNumber: 1,
      steps: {
        schema: { passed: true, durationMs: 1, details: {} },
        sectionPresence: { passed: true, durationMs: 1, details: {} },
        detailSufficiency: { passed: true, durationMs: 4, details: {} },
        contentRelevance: {
          passed: true,
          durationMs: 800,
          details: {},
          perSection: { architecture: { passed: true, score: 4, concerns: [] } },
        },
        crossSectionConsistency: {
          passed: true,
          score: 5,
          durationMs: 600,
          details: { consistent: true },
        },
        completenessGestalt: {
          passed: true,
          durationMs: 900,
          details: {},
          testingAgentReady: 5,
          codingAgentReady: 4,
          blockers: [],
          rationale: 'fine',
        },
      },
      failedChecks: [],
      warnings: [],
      fixSuggestions: [],
    };

    db.update(stories)
      .set({
        validationReport: JSON.stringify(report),
        validationStatus: 'passed',
        validationAttempts: 1,
        lastValidatedAt: report.ranAt,
      })
      .where(eq(stories.id, 'stry_val_test'))
      .run();

    const row = db.select().from(stories).where(eq(stories.id, 'stry_val_test')).get();
    expect(row!.validationStatus).toBe('passed');
    expect(row!.validationAttempts).toBe(1);
    expect(row!.lastValidatedAt).toBe(report.ranAt);

    const parsed = JSON.parse(row!.validationReport!);
    expect(parsed.rubricVersion).toBe('v1');
    expect(parsed.score).toBe(91);
    expect(parsed.nextAction).toBe('proceed');
    expect(parsed.steps.contentRelevance.perSection.architecture.score).toBe(4);
  });

  it('accepts the full lifecycle of validation_status values', () => {
    const { db } = setupDb();
    for (const status of ['pending', 'in_progress', 'passed', 'failed', 'escalated']) {
      db.update(stories)
        .set({ validationStatus: status })
        .where(eq(stories.id, 'stry_val_test'))
        .run();
      const row = db.select().from(stories).where(eq(stories.id, 'stry_val_test')).get();
      expect(row!.validationStatus).toBe(status);
    }
  });

  it('story_validation_status_idx is queryable (covers bucket-placer ready pool)', () => {
    const { db, sqlite } = setupDb();
    for (const [id, status] of [
      ['stry_a', 'pending'],
      ['stry_b', 'passed'],
      ['stry_c', 'failed'],
      ['stry_d', 'passed'],
    ] as const) {
      db.insert(stories)
        .values({
          id,
          title: id,
          kind: 'story',
          createdAt: nowIso(),
          rootPromptId: 'prm_val_test',
          validationStatus: status,
        })
        .run();
    }

    const passedRows = sqlite
      .prepare(`SELECT id FROM stories WHERE validation_status = 'passed' ORDER BY id`)
      .all() as { id: string }[];
    expect(passedRows.map((r) => r.id)).toEqual(['stry_b', 'stry_d']);

    const idx = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='story_validation_status_idx'`,
      )
      .get();
    expect(idx).toBeTruthy();

    const idx2 = sqlite
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='index' AND name='story_validation_attempts_idx'`,
      )
      .get();
    expect(idx2).toBeTruthy();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  insertObservation,
  recordActed,
  listObservations,
} from '../src/db.js';

function freshDb(): Database.Database {
  const db = new Database(':memory:');
  // Mirror the columns used in the migration; production migrations create the table elsewhere.
  db.exec(`
    CREATE TABLE smart_cicd_observations (
      id TEXT PRIMARY KEY,
      observation_date INTEGER NOT NULL,
      bucket_name TEXT NOT NULL,
      root_cause TEXT NOT NULL,
      root_cause_confidence REAL NOT NULL,
      proposed_action_kind TEXT NOT NULL,
      proposed_action_payload_json TEXT NOT NULL,
      acted_at INTEGER,
      acted_outcome TEXT,
      feedback_label TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('Smart CI/CD db handlers', () => {
  let db: Database.Database;
  beforeEach(() => {
    db = freshDb();
  });

  it('insertObservation persists a propose-only row', () => {
    const id = insertObservation(db, {
      observationDate: 1779000000000,
      bucketName: 'lint_failures',
      rootCause: 'code-style-drift',
      rootCauseConfidence: 0.9,
      proposedActionKind: 'silent',
      proposedActionPayload: { kind: 'silent', note: 'one-off blip' },
    });
    expect(id).toMatch(/^smart-cicd-/);

    const row = db
      .prepare('SELECT * FROM smart_cicd_observations WHERE id = ?')
      .get(id) as Record<string, unknown>;
    expect(row.bucket_name).toBe('lint_failures');
    expect(row.acted_at).toBeNull();
    expect(row.acted_outcome).toBeNull();
    expect(row.feedback_label).toBe('pending');
  });

  it('recordActed marks acted_at + acted_outcome', () => {
    const id = insertObservation(db, {
      observationDate: 1779000000000,
      bucketName: 'merge_conflicts',
      rootCause: 'merge-conflict-policy-gap',
      rootCauseConfidence: 0.7,
      proposedActionKind: 'rec-issue',
      proposedActionPayload: {
        kind: 'rec-issue',
        title: 'Recurring merge conflicts in apps/dashboard',
        body: 'Last 24h: 7 conflicts on the same files.',
        labels: ['workflow', 'observability'],
      },
    });
    recordActed(db, { id, actedOutcome: 'still-open' });

    const row = db
      .prepare('SELECT acted_at, acted_outcome, feedback_label FROM smart_cicd_observations WHERE id = ?')
      .get(id) as Record<string, unknown>;
    expect(row.acted_at).toBeGreaterThan(0);
    expect(row.acted_outcome).toBe('still-open');
    // feedback_label should preserve initial 'pending' if not overridden.
    expect(row.feedback_label).toBe('pending');
  });

  it('listObservations returns rows in created_at window', () => {
    const ids = [
      insertObservation(db, {
        observationDate: 1,
        bucketName: 'lint_failures',
        rootCause: 'unknown',
        rootCauseConfidence: 0,
        proposedActionKind: 'silent',
        proposedActionPayload: { kind: 'silent', note: 'a' },
      }),
      insertObservation(db, {
        observationDate: 2,
        bucketName: 'typecheck_failures',
        rootCause: 'unknown',
        rootCauseConfidence: 0,
        proposedActionKind: 'silent',
        proposedActionPayload: { kind: 'silent', note: 'b' },
      }),
    ];
    const rows = listObservations(db, 0, Date.now() + 60_000);
    expect(rows.map((r) => r.id).sort()).toEqual([...ids].sort());
    rows.forEach((r) => expect(r.feedbackLabel).toBe('pending'));
  });
});

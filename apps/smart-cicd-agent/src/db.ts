/**
 * Smart CI/CD Agent — SQLite handlers (better-sqlite3).
 *
 * Mirrors migration 0052_smart_cicd_observations.sql.
 *
 * The agent is propose-only. This module never writes acted_outcome or
 * feedback_label other than to the values dictated by an operator action.
 */

import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';
import type {
  ActedOutcome,
  FeedbackLabel,
  Observation,
  ProposedActionKind,
  ProposedActionPayload,
} from './types.js';
import { Observation as ObservationSchema } from './types.js';

/**
 * Insert a new observation row. Returns the row's id.
 */
export function insertObservation(
  db: Database.Database,
  args: {
    observationDate: number; // ms epoch (rounded to local-midnight by caller)
    bucketName: string;
    rootCause: string;
    rootCauseConfidence: number;
    proposedActionKind: ProposedActionKind;
    proposedActionPayload: ProposedActionPayload;
  }
): string {
  const id = `smart-cicd-${nanoid(12)}`;
  const stmt = db.prepare(
    `INSERT INTO smart_cicd_observations
       (id, observation_date, bucket_name, root_cause, root_cause_confidence,
        proposed_action_kind, proposed_action_payload_json,
        acted_at, acted_outcome, feedback_label, created_at)
     VALUES
       (@id, @observation_date, @bucket_name, @root_cause, @root_cause_confidence,
        @proposed_action_kind, @proposed_action_payload_json,
        NULL, NULL, 'pending', @created_at)`
  );
  stmt.run({
    id,
    observation_date: args.observationDate,
    bucket_name: args.bucketName,
    root_cause: args.rootCause,
    root_cause_confidence: args.rootCauseConfidence,
    proposed_action_kind: args.proposedActionKind,
    proposed_action_payload_json: JSON.stringify(args.proposedActionPayload),
    created_at: Date.now(),
  });
  return id;
}

/**
 * Mark a previously-recorded observation as acted upon. Used by the
 * propose-only ACT step to record what kind of artifact was produced
 * (PR opened, issue filed, draft prompt registered, …) and later by the
 * weekly self-improve to record the operator's verdict.
 */
export function recordActed(
  db: Database.Database,
  args: {
    id: string;
    actedOutcome: ActedOutcome;
    feedbackLabel?: FeedbackLabel | null;
  }
): void {
  db.prepare(
    `UPDATE smart_cicd_observations
       SET acted_at        = @acted_at,
           acted_outcome   = @acted_outcome,
           feedback_label  = COALESCE(@feedback_label, feedback_label)
     WHERE id = @id`
  ).run({
    id: args.id,
    acted_at: Date.now(),
    acted_outcome: args.actedOutcome,
    feedback_label: args.feedbackLabel ?? null,
  });
}

/**
 * Read observations for the daily/weekly self-review windows.
 * `windowStartMs` inclusive, `windowEndMs` exclusive.
 */
export function listObservations(
  db: Database.Database,
  windowStartMs: number,
  windowEndMs: number
): Observation[] {
  const rows = db
    .prepare(
      `SELECT id, observation_date, bucket_name, root_cause, root_cause_confidence,
              proposed_action_kind, proposed_action_payload_json,
              acted_at, acted_outcome, feedback_label, created_at
         FROM smart_cicd_observations
        WHERE created_at >= ? AND created_at < ?
        ORDER BY created_at ASC`
    )
    .all(windowStartMs, windowEndMs) as Array<Record<string, unknown>>;

  return rows.map((row) =>
    ObservationSchema.parse({
      id: row.id,
      observationDate: row.observation_date,
      bucketName: row.bucket_name,
      rootCause: row.root_cause,
      rootCauseConfidence: row.root_cause_confidence,
      proposedActionKind: row.proposed_action_kind,
      proposedActionPayload: JSON.parse(
        String(row.proposed_action_payload_json)
      ),
      actedAt: row.acted_at,
      actedOutcome: row.acted_outcome,
      feedbackLabel: row.feedback_label,
      createdAt: row.created_at,
    })
  );
}

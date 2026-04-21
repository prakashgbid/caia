-- Migration 0012: prioritization engine
-- Adds auto-scoring, bucketing, and ordinal placement to tasks.
-- Adds append-only priority_audit table.

-- ── ALTER tasks ──────────────────────────────────────────────────────────────

ALTER TABLE tasks ADD COLUMN priority_score INTEGER NOT NULL DEFAULT 50;
ALTER TABLE tasks ADD COLUMN priority_bucket TEXT NOT NULL DEFAULT 'P2';
ALTER TABLE tasks ADD COLUMN position_ordinal INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN priority_rationale_json TEXT;
ALTER TABLE tasks ADD COLUMN last_prioritized_at TEXT;

--> statement-breakpoint
CREATE INDEX task_priority_idx ON tasks (priority_bucket, position_ordinal);

-- ── priority_audit ───────────────────────────────────────────────────────────

CREATE TABLE priority_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id         TEXT    NOT NULL,
  old_score       INTEGER,
  new_score       INTEGER NOT NULL,
  old_bucket      TEXT,
  new_bucket      TEXT    NOT NULL,
  reason          TEXT    NOT NULL DEFAULT '',
  actor           TEXT    NOT NULL DEFAULT 'system',
  changed_at      TEXT    NOT NULL
);

--> statement-breakpoint
CREATE INDEX pa_task_idx     ON priority_audit (task_id);
CREATE INDEX pa_changed_idx  ON priority_audit (changed_at);

-- migration 0053: steward_events + steward_process_state
--
-- DevOps Steward Agent — process-graph evaluator (P0).
-- Reference: ~/Documents/projects/reports/devops-steward-agent-design-2026-05-03.md §3.3.
--
-- Two new tables, both append-only or per-key-current:
--   * steward_events         — every observed event (GitHub, FS, orchestrator-db, self)
--   * steward_process_state  — current open lifecycles per (process_id, lifecycle_key)
--
-- The Steward writes drift detections into the existing smart_cicd_observations
-- table (migration 0052) using new bucket_name values prefixed `steward_`.
-- That allows one unified observability surface and one self-review pipeline.

CREATE TABLE IF NOT EXISTS steward_events (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  repo TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  correlation_id TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS steward_events_observed ON steward_events(observed_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS steward_events_type ON steward_events(type);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS steward_events_corr ON steward_events(correlation_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS steward_process_state (
  process_id TEXT NOT NULL,
  lifecycle_key TEXT NOT NULL,
  current_state TEXT NOT NULL,
  state_observed_at INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (process_id, lifecycle_key)
);

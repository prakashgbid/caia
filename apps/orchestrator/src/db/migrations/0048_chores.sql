-- migration 0048: chores table
-- Single-domain backend tasks routed directly to the backend specialist.
-- Target SLO: 20s. status: queued | triaging | executing | done | failed

CREATE TABLE IF NOT EXISTS chores (
  id TEXT PRIMARY KEY,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  domain TEXT NOT NULL DEFAULT 'backend',
  slo_ms INTEGER NOT NULL DEFAULT 20000,
  story_id TEXT,
  project_id TEXT REFERENCES projects(id),
  scope TEXT NOT NULL DEFAULT 'global',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS chore_status_idx ON chores(status);
CREATE INDEX IF NOT EXISTS chore_project_idx ON chores(project_id);
CREATE INDEX IF NOT EXISTS chore_story_idx ON chores(story_id);
CREATE INDEX IF NOT EXISTS chore_created_idx ON chores(created_at);

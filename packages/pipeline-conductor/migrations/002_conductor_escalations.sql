-- @caia/pipeline-conductor — 002_conductor_escalations.sql
-- Open/closed escalations raised by the conductor's watchdog loop. Spec §7.2.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.conductor_escalations (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id        UUID         NOT NULL REFERENCES caia_meta.tenant_projects(id),
  stage             TEXT         NOT NULL,
  reason            TEXT         NOT NULL,
  threshold_seconds INT          NOT NULL,
  elapsed_seconds   INT          NOT NULL,
  last_event_id     TEXT,
  opened_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
  closed_at         TIMESTAMPTZ,
  resolution        TEXT,
  notes             TEXT,
  context           JSONB        NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS conductor_escalations_project_open_idx
  ON caia_meta.conductor_escalations (project_id) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS conductor_escalations_open_stage_idx
  ON caia_meta.conductor_escalations (stage) WHERE closed_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS conductor_escalations_open_unique_idx
  ON caia_meta.conductor_escalations (project_id, stage, reason)
  WHERE closed_at IS NULL;

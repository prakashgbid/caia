-- @caia/pipeline-conductor — 003_conductor_stage_durations.sql
-- Per-stage duration log for the forecaster. Spec §7.3.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.conductor_stage_durations (
  id               BIGSERIAL    PRIMARY KEY,
  tenant_id        TEXT         NOT NULL,
  project_id       UUID         NOT NULL REFERENCES caia_meta.tenant_projects(id),
  stage            TEXT         NOT NULL,
  entered_at       TIMESTAMPTZ  NOT NULL,
  exited_at        TIMESTAMPTZ  NOT NULL,
  duration_seconds INT          NOT NULL,
  exit_reason      TEXT         NOT NULL
                                CHECK (exit_reason IN ('succeeded','failed-recovered','abandoned')),
  retry_count      INT          NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS conductor_stage_durations_tenant_stage_idx
  ON caia_meta.conductor_stage_durations (tenant_id, stage, entered_at DESC);
CREATE INDEX IF NOT EXISTS conductor_stage_durations_stage_global_idx
  ON caia_meta.conductor_stage_durations (stage, entered_at DESC);
CREATE INDEX IF NOT EXISTS conductor_stage_durations_project_idx
  ON caia_meta.conductor_stage_durations (project_id, stage);

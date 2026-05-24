-- @caia/pipeline-conductor — 001_mv_pipeline_status.sql
--
-- The materialised view that backs the operator dashboard's "where is every
-- project right now?" query. Refreshed CONCURRENTLY by the projector daemon
-- whenever a relevant event (state transition, agent claim, heartbeat) is
-- observed within the last second.
--
-- Sourced from research/conductor_agent_spec_2026.md §7.1.

CREATE SCHEMA IF NOT EXISTS caia_meta;

CREATE TABLE IF NOT EXISTS caia_meta.agent_runs (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID         NOT NULL REFERENCES caia_meta.tenant_projects(id),
  agent            TEXT         NOT NULL,
  status           TEXT         NOT NULL DEFAULT 'running'
                                CHECK (status IN ('running','succeeded','failed','cancelled')),
  claimed_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  heartbeat_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  error_message    TEXT
);

CREATE INDEX IF NOT EXISTS agent_runs_project_status_idx
  ON caia_meta.agent_runs(project_id, status);
CREATE INDEX IF NOT EXISTS agent_runs_heartbeat_idx
  ON caia_meta.agent_runs(heartbeat_at) WHERE status = 'running';

CREATE OR REPLACE FUNCTION caia_meta.latest_running_agent_run(p_project_id UUID)
RETURNS TABLE (
  id           UUID,
  agent        TEXT,
  claimed_at   TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ
)
LANGUAGE sql STABLE
AS $$
  SELECT ar.id, ar.agent, ar.claimed_at, ar.heartbeat_at
  FROM caia_meta.agent_runs ar
  WHERE ar.project_id = p_project_id
    AND ar.status = 'running'
  ORDER BY ar.claimed_at DESC
  LIMIT 1;
$$;

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

DROP MATERIALIZED VIEW IF EXISTS caia_meta.mv_pipeline_status;
CREATE MATERIALIZED VIEW caia_meta.mv_pipeline_status AS
SELECT
  p.id                                                              AS project_id,
  p.tenant_id,
  p.slug,
  p.display_name,
  p.status,
  p.paused,
  p.paused_at,
  p.paused_by,
  p.last_transitioned_at,
  p.last_transitioned_by,
  EXTRACT(EPOCH FROM (now() - p.last_transitioned_at))::INT         AS seconds_in_state,
  (SELECT count(*)::INT FROM caia_meta.state_history h
     WHERE h.project_id = p.id)                                     AS total_transitions,
  ar.id                                                             AS active_agent_run_id,
  ar.agent                                                          AS active_agent,
  ar.claimed_at                                                     AS active_agent_claimed_at,
  ar.heartbeat_at                                                   AS active_agent_heartbeat_at,
  CASE WHEN ar.heartbeat_at IS NULL THEN NULL
       ELSE EXTRACT(EPOCH FROM (now() - ar.heartbeat_at))::INT END  AS seconds_since_heartbeat,
  (SELECT count(*)::INT FROM caia_meta.conductor_escalations e
     WHERE e.project_id = p.id AND e.closed_at IS NULL)             AS open_escalations,
  now()                                                             AS refreshed_at
FROM caia_meta.tenant_projects p
LEFT JOIN LATERAL (
  SELECT id, agent, claimed_at, heartbeat_at
  FROM caia_meta.latest_running_agent_run(p.id)
) ar ON true
WHERE p.archived_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS mv_pipeline_status_pid_idx
  ON caia_meta.mv_pipeline_status (project_id);
CREATE INDEX IF NOT EXISTS mv_pipeline_status_status_idx
  ON caia_meta.mv_pipeline_status (status);
CREATE INDEX IF NOT EXISTS mv_pipeline_status_tenant_idx
  ON caia_meta.mv_pipeline_status (tenant_id);
CREATE INDEX IF NOT EXISTS mv_pipeline_status_active_idx
  ON caia_meta.mv_pipeline_status (paused) WHERE paused = false;

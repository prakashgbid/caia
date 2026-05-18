-- Migration: create the mesh_supervisor schema + artifact_provenance table.
-- Idempotent. Apply with:
--   PGPASSWORD=... psql -h <host> -U stolution -d stolution -f apps/mesh-supervisor/python/migrations/001_mesh_supervisor_schema.sql
--
-- The langgraph_checkpoints table itself is created by PostgresSaver.setup()
-- the first time the supervisor boots — see python/checkpointer.py.
--
-- Per p4_agent_mesh_implementation_plan_2026_05_16.md §4.3 + M0 deliverables.

CREATE SCHEMA IF NOT EXISTS mesh_supervisor;

GRANT USAGE ON SCHEMA mesh_supervisor TO stolution;
GRANT ALL PRIVILEGES ON SCHEMA mesh_supervisor TO stolution;

CREATE TABLE IF NOT EXISTS mesh_supervisor.artifact_provenance (
  id                  BIGSERIAL PRIMARY KEY,
  task_id             TEXT NOT NULL,
  context_id          TEXT NOT NULL,
  producer_model      TEXT NOT NULL,
  producer_version    TEXT,
  reviewer_model      TEXT,
  evidence_gate_run   TEXT,
  caia_chain_run_id   TEXT,
  caia_phase_step_id  TEXT,
  parent_artifact_id  BIGINT,
  artifact_kind       TEXT,
  artifact_uri        TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifact_provenance_context_id_idx
  ON mesh_supervisor.artifact_provenance (context_id);
CREATE INDEX IF NOT EXISTS artifact_provenance_task_id_idx
  ON mesh_supervisor.artifact_provenance (task_id);
CREATE INDEX IF NOT EXISTS artifact_provenance_chain_id_idx
  ON mesh_supervisor.artifact_provenance (caia_chain_run_id);

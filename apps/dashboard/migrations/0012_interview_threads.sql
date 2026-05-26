-- 0012_interview_threads.sql — per-tenant interview_threads table.
--
-- Applied against EACH tenant's schema (the `{{SCHEMA}}` placeholder is
-- substituted at apply time by the migration runner, mirroring the pattern
-- used by 0010_wizard_state.sql, @caia/grand-idea/migrations, and
-- @caia/info-architect/migrations). Idempotent — every CREATE uses
-- `IF NOT EXISTS`.
--
-- Owns the multi-turn Q&A history for Step 3 — Interview. One row per
-- thread (a thread = one full interview attempt for a project). The
-- interviewer engine in `@caia/interviewer` owns its own per-package
-- migration (`packages/interviewer/migrations/0001_interviewer.sql`)
-- which is more granular (turns table, snapshots, etc.); this
-- dashboard-side table is a denormalized projection that the wizard UI
-- and `/api/wizard/interview/answer` use for fast renders without
-- joining the engine's turns table.
--
-- Shape:
--   thread_id        — PK; one row per attempt.
--   project_id       — FK-by-convention to the per-tenant projects table
--                      (the wizard state machine's project table). The
--                      reference is not declared with REFERENCES because
--                      the projects table lives in the same tenant schema
--                      but the actual table name varies by deployment
--                      generation (it is `tenant_projects` in the canonical
--                      schema as of @caia/state-machine 0.6.x).
--   q_a_pairs        — JSONB array of {turn, role, content, askedAt, answeredAt}
--                      objects, ordered by turn ascending. The wizard
--                      reads/writes the WHOLE array on each turn for
--                      simplicity at V1 scale (≤ 50 turns / interview).
--   pillar_coverage  — JSONB object keyed by PillarId (B1..B16) with
--                      { score: number, hits: number, lastTouchedTurn:
--                      number } values. Surfaces the 16-pillar radar.
--   started_at       — set on first INSERT.
--   updated_at       — touched on every UPDATE via the trigger below.
--   completed_at     — set when the wizard FSM advances to
--                      `interview-complete`; null while in progress.

CREATE TABLE IF NOT EXISTS "{{SCHEMA}}".interview_threads (
  thread_id         UUID         PRIMARY KEY,
  project_id        UUID         NOT NULL,
  q_a_pairs         JSONB        NOT NULL DEFAULT '[]'::jsonb,
  pillar_coverage   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  started_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  completed_at      TIMESTAMPTZ
);

-- One in-flight thread per project. Completed threads keep their rows;
-- a brand-new attempt against the same project_id (e.g. after a force-
-- close + restart) inserts a new thread_id. The partial-unique guard
-- below prevents two concurrent in-flight threads for the same project.
CREATE UNIQUE INDEX IF NOT EXISTS interview_threads_one_open_per_project_idx
  ON "{{SCHEMA}}".interview_threads (project_id)
  WHERE completed_at IS NULL;

CREATE INDEX IF NOT EXISTS interview_threads_project_idx
  ON "{{SCHEMA}}".interview_threads (project_id);

CREATE INDEX IF NOT EXISTS interview_threads_updated_idx
  ON "{{SCHEMA}}".interview_threads (updated_at DESC);

-- Touch updated_at on any UPDATE. Per-tenant trigger names must be
-- unique inside the schema; `interview_threads` is unique already.
CREATE OR REPLACE FUNCTION "{{SCHEMA}}".interview_threads_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_threads_touch ON "{{SCHEMA}}".interview_threads;
CREATE TRIGGER interview_threads_touch
  BEFORE UPDATE ON "{{SCHEMA}}".interview_threads
  FOR EACH ROW
  EXECUTE FUNCTION "{{SCHEMA}}".interview_threads_touch_updated_at();

-- @caia/interviewer — per-tenant Postgres schema.
--
-- This file is a TEMPLATE: callers substitute `{{SCHEMA}}` with the
-- target tenant schema (e.g., `caia_pt` for project `prakash-tiwari`)
-- when applying. The InterviewerPersistence class does the substitution
-- automatically via `ensureSchema()` so most callers never touch this
-- file directly.
--
-- Per spec §6:
--   - interviews              header (1 row per interview)
--   - interview_turns         immutable per-turn audit log
--   - business_plan_revisions append-only plan snapshots with JSON Patch
--   - interview_deferred      denormalized deferred-question queue

CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.interviews (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug            TEXT NOT NULL,
  operator_email         TEXT NOT NULL,
  grand_idea_prompt      TEXT NOT NULL,
  state                  TEXT NOT NULL DEFAULT 'INIT'
                         CHECK (state IN ('INIT','PLANNING','ASKING','AWAITING_USER',
                                          'INGESTING','EVALUATING','SELF_CRITIQUE',
                                          'COMPLETE','HANDOFF','PAUSED','FORCE_CLOSED')),
  responder_role         TEXT NOT NULL DEFAULT 'founder'
                         CHECK (responder_role IN ('founder','operator','customer')),
  turn_number            INTEGER NOT NULL DEFAULT 0,
  llm_call_count         INTEGER NOT NULL DEFAULT 0,
  llm_call_budget        INTEGER NOT NULL DEFAULT 150,
  critic_passes_run      INTEGER NOT NULL DEFAULT 0,
  fatigue_overrides      INTEGER NOT NULL DEFAULT 0,
  business_plan_document JSONB NOT NULL DEFAULT '{}'::jsonb,
  rubric_aggregate_score NUMERIC(5,2),
  close_reason           TEXT,
  closed_by              TEXT,
  started_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  paused_at              TIMESTAMPTZ,
  resumed_at             TIMESTAMPTZ,
  completed_at           TIMESTAMPTZ,
  metadata               JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT interviews_close_reason_valid
    CHECK (close_reason IS NULL OR close_reason IN
           ('agent_complete','operator_force','session_timeout','budget_exceeded'))
);

CREATE INDEX IF NOT EXISTS interviews_tenant_state_idx
  ON {{SCHEMA}}.interviews (tenant_slug, state);

CREATE INDEX IF NOT EXISTS interviews_plan_gin_idx
  ON {{SCHEMA}}.interviews USING GIN (business_plan_document);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.interview_turns (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id        UUID NOT NULL REFERENCES {{SCHEMA}}.interviews(id) ON DELETE CASCADE,
  turn_number         INTEGER NOT NULL,
  role                TEXT NOT NULL CHECK (role IN ('agent','user','system')),
  content             TEXT NOT NULL,
  question_ids        TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  pillars_covered     TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
  asked_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at         TIMESTAMPTZ,
  llm_call_count      INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (interview_id, turn_number, role)
);

CREATE INDEX IF NOT EXISTS interview_turns_interview_turn_idx
  ON {{SCHEMA}}.interview_turns (interview_id, turn_number);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.business_plan_revisions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id        UUID NOT NULL REFERENCES {{SCHEMA}}.interviews(id) ON DELETE CASCADE,
  revision_number     INTEGER NOT NULL,
  at_turn_number      INTEGER NOT NULL,
  document            JSONB NOT NULL,
  diff_from_prev      JSONB,
  rubric_scores       JSONB NOT NULL DEFAULT '{}'::jsonb,
  satisfaction_score  NUMERIC(5,2),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (interview_id, revision_number)
);

CREATE INDEX IF NOT EXISTS business_plan_revisions_interview_revision_idx
  ON {{SCHEMA}}.business_plan_revisions (interview_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.interview_deferred (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interview_id        UUID NOT NULL REFERENCES {{SCHEMA}}.interviews(id) ON DELETE CASCADE,
  question_id         TEXT NOT NULL,
  asked_at_turn       INTEGER NOT NULL,
  reason              TEXT NOT NULL
                       CHECK (reason IN ('user_skipped','agent_low_priority','rephrase_exhausted','founder_doesnt_know')),
  revisit_after_turn  INTEGER,
  resolved_at_turn    INTEGER,
  defer_count         INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS interview_deferred_interview_idx
  ON {{SCHEMA}}.interview_deferred (interview_id, question_id);

-- LISTEN/NOTIFY trigger — dashboard SSE wakeup

CREATE OR REPLACE FUNCTION {{SCHEMA}}.notify_interview_revision() RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('interview_revision', NEW.interview_id::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS interview_revision_notify ON {{SCHEMA}}.business_plan_revisions;
CREATE TRIGGER interview_revision_notify
  AFTER INSERT ON {{SCHEMA}}.business_plan_revisions
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_interview_revision();

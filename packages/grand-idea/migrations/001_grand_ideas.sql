-- @caia/grand-idea — per-tenant Postgres schema.
--
-- This file is a TEMPLATE: callers substitute `{{SCHEMA}}` with the
-- target tenant schema (e.g., `caia_pt` for project `prakash-tiwari`)
-- when applying. The GrandIdeaPersistence class does the substitution
-- automatically via `ensureSchema()` so most callers never touch this
-- file directly.
--
-- Single table per spec:
--   - grand_ideas    immutable per-revision capture of the founder's
--                    prompt; the Interviewer reads the latest row.

CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.grand_ideas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug         TEXT NOT NULL,
  project_id          UUID NOT NULL,
  revision_number     INTEGER NOT NULL,
  prompt              TEXT NOT NULL,
  prompt_word_count   INTEGER NOT NULL,
  captured_by         TEXT NOT NULL,
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (project_id, revision_number),
  CHECK (prompt_word_count >= 5),
  CHECK (prompt_word_count <= 5000),
  CHECK (length(trim(prompt)) > 0)
);

CREATE INDEX IF NOT EXISTS grand_ideas_tenant_project_revision_idx
  ON {{SCHEMA}}.grand_ideas (tenant_slug, project_id, revision_number DESC);

CREATE INDEX IF NOT EXISTS grand_ideas_project_latest_idx
  ON {{SCHEMA}}.grand_ideas (project_id, captured_at DESC);

-- LISTEN/NOTIFY trigger — dashboard SSE wakeup.
CREATE OR REPLACE FUNCTION {{SCHEMA}}.notify_grand_idea_captured()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('grand_idea_captured',
    json_build_object(
      'tenant_slug', NEW.tenant_slug,
      'project_id', NEW.project_id::text,
      'revision_number', NEW.revision_number
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS grand_idea_captured_notify ON {{SCHEMA}}.grand_ideas;
CREATE TRIGGER grand_idea_captured_notify
  AFTER INSERT ON {{SCHEMA}}.grand_ideas
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_grand_idea_captured();

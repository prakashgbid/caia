-- @caia/info-architect — per-tenant Postgres schema.
--
-- TEMPLATE: callers substitute `{{SCHEMA}}` with the target tenant
-- schema (e.g., `"caia_pt"` for project `prakash-tiwari`) when applying.
-- The IaPostgresPersistence class does the substitution automatically
-- via `ensureSchema()`, so most callers never touch this file directly.
-- Mirrors the substitution convention used by @caia/grand-idea.
--
-- Three tables per IA spec §15 (Wave 1 keeps the schema minimal — no
-- parent ia_revisions table; revision id is column-local. Wave 2 will
-- extract the parent revision table and add the cross-project template
-- lookup index):
--
--   - pages_catalogue   per-project current pointer + JSONB document
--   - design_systems    same shape; plus template_name for §10 reuse
--   - components_library same shape; GIN index on document->'components'
--
-- The Postgres advisory-lock key used by the orchestrator (per IA spec
-- §6.2) is the pair `('caia.ia', tenantProjectId, 0)`. It does not
-- need a table — Postgres's `pg_advisory_lock(int4, int4)` is enough.

CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

-- ---------------------------------------------------------------------------
-- pages_catalogue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.pages_catalogue (
  tenant_project_id        UUID         PRIMARY KEY,
  current_ia_revision_id   TEXT         NOT NULL,
  document                 JSONB        NOT NULL,
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (length(current_ia_revision_id) > 0),
  CHECK (jsonb_typeof(document) = 'object'),
  CHECK ((document ? 'site') AND (document ? 'templates') AND (document ? 'pages'))
);

CREATE INDEX IF NOT EXISTS pages_catalogue_updated_at_idx
  ON {{SCHEMA}}.pages_catalogue (updated_at DESC);

CREATE INDEX IF NOT EXISTS pages_catalogue_revision_idx
  ON {{SCHEMA}}.pages_catalogue (current_ia_revision_id);

-- ---------------------------------------------------------------------------
-- design_systems
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.design_systems (
  tenant_project_id        UUID         PRIMARY KEY,
  current_ia_revision_id   TEXT         NOT NULL,
  document                 JSONB        NOT NULL,
  -- Cross-site reuse pointer per IA spec §10 — set when this project's
  -- design system is published as a reusable template.
  template_name            TEXT,
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (length(current_ia_revision_id) > 0),
  CHECK (jsonb_typeof(document) = 'object'),
  CHECK ((document ? 'tailwindConfig') AND (document ? 'cssVariables'))
);

CREATE INDEX IF NOT EXISTS design_systems_template_name_idx
  ON {{SCHEMA}}.design_systems (template_name)
  WHERE template_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS design_systems_revision_idx
  ON {{SCHEMA}}.design_systems (current_ia_revision_id);

-- ---------------------------------------------------------------------------
-- components_library
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS {{SCHEMA}}.components_library (
  tenant_project_id        UUID         PRIMARY KEY,
  current_ia_revision_id   TEXT         NOT NULL,
  document                 JSONB        NOT NULL,
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CHECK (length(current_ia_revision_id) > 0),
  CHECK (jsonb_typeof(document) = 'object'),
  CHECK (document ? 'components')
);

CREATE INDEX IF NOT EXISTS components_library_revision_idx
  ON {{SCHEMA}}.components_library (current_ia_revision_id);

-- GIN index for archetype lookups (e.g. "find every project whose IA
-- catalogues the OAuth-code-grant archetype").
CREATE INDEX IF NOT EXISTS components_library_document_gin
  ON {{SCHEMA}}.components_library
  USING GIN ((document -> 'components'));

-- ---------------------------------------------------------------------------
-- Notification trigger — dashboard SSE wakeup. Mirrors @caia/grand-idea.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION {{SCHEMA}}.notify_ia_revision_updated()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('ia_revision_updated',
    json_build_object(
      'tenant_project_id', NEW.tenant_project_id::text,
      'current_ia_revision_id', NEW.current_ia_revision_id,
      'table', TG_TABLE_NAME
    )::text
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS pages_catalogue_notify ON {{SCHEMA}}.pages_catalogue;
CREATE TRIGGER pages_catalogue_notify
  AFTER INSERT OR UPDATE ON {{SCHEMA}}.pages_catalogue
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_ia_revision_updated();

DROP TRIGGER IF EXISTS design_systems_notify ON {{SCHEMA}}.design_systems;
CREATE TRIGGER design_systems_notify
  AFTER INSERT OR UPDATE ON {{SCHEMA}}.design_systems
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_ia_revision_updated();

DROP TRIGGER IF EXISTS components_library_notify ON {{SCHEMA}}.components_library;
CREATE TRIGGER components_library_notify
  AFTER INSERT OR UPDATE ON {{SCHEMA}}.components_library
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_ia_revision_updated();

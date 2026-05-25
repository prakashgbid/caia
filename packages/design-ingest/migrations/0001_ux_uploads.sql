-- @caia/design-ingest — ux_uploads DDL.
--
-- Reference: research/step5_design_ingest_spec_2026.md §4.
--
-- Idempotent copy of the table @caia/atlas-design-snapshotter also
-- creates (in its migration 0001_design_versions.sql). Either migration
-- may run first; the IF NOT EXISTS guards make co-existence safe.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ux_upload_status') THEN
    CREATE TYPE ux_upload_status AS ENUM ('uploading', 'parsing', 'parsed', 'failed');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ux_uploads (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  business_proposal_id UUID,
  source               TEXT NOT NULL,
  source_metadata      JSONB NOT NULL DEFAULT '{}'::jsonb,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rendered_design      JSONB,
  status               ux_upload_status NOT NULL DEFAULT 'uploading',
  parse_diagnostics    JSONB,
  parse_duration_ms    INT,
  failure_reason       TEXT
);

CREATE INDEX IF NOT EXISTS ux_uploads_tenant_idx ON ux_uploads(tenant_id);
CREATE INDEX IF NOT EXISTS ux_uploads_proposal_idx ON ux_uploads(business_proposal_id);
CREATE INDEX IF NOT EXISTS ux_uploads_status_idx ON ux_uploads(status)
  WHERE status <> 'parsed';

-- @caia/atlas-design-snapshotter — design_versions DDL for a tenant schema.
--
-- Reference: research/step5_design_ingest_spec_2026.md §4
--
-- Atlas's "UX Version Control" requirement: the design is never overwritten.
-- Every upload creates a new row in ux_uploads + design_versions; revert
-- forward-creates v(N+1) equal to v(N) by copying the parent's payload.
--
-- This file is intentionally schema-agnostic — the tenant provisioner sets
-- `search_path = caia_<short>, public` before applying it. For integration
-- tests we apply it to the `public` schema of a throwaway Postgres.

-- ux_upload_status enum --------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ux_upload_status') THEN
    CREATE TYPE ux_upload_status AS ENUM ('uploading', 'parsing', 'parsed', 'failed');
  END IF;
END $$;

-- ux_uploads --------------------------------------------------------------
-- Idempotent fixture: integration tests need the upload row to point at,
-- so we provide a minimal-shape table that real intake will FK to as well.
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

-- design_assets -----------------------------------------------------------
-- Content-hash addressed. The (tenant_id, content_hash) pair is the
-- dedup key: identical bytes in the same tenant share one row + one
-- blob upload.
CREATE TABLE IF NOT EXISTS design_assets (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL,
  content_hash      TEXT NOT NULL,
  storage_url       TEXT NOT NULL,
  size_bytes        BIGINT NOT NULL,
  mime_type         TEXT,
  first_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref_count         INT NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, content_hash)
);

CREATE INDEX IF NOT EXISTS design_assets_hash_idx ON design_assets(content_hash);
CREATE INDEX IF NOT EXISTS design_assets_tenant_idx ON design_assets(tenant_id);

-- design_version_assets ---------------------------------------------------
-- M:N edge — which asset rows a particular design_version uses, and
-- the path the design referenced them under (so a single dedup row can
-- back many design references at /headshot.jpg, /team/me.jpg, ...).
CREATE TABLE IF NOT EXISTS design_version_assets (
  design_version_id  UUID NOT NULL,
  asset_id           UUID NOT NULL REFERENCES design_assets(id) ON DELETE CASCADE,
  path               TEXT NOT NULL,
  kind               TEXT,
  alt_text           TEXT,
  intrinsic_w        INT,
  intrinsic_h        INT,
  is_placeholder     BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (design_version_id, path)
);

CREATE INDEX IF NOT EXISTS design_version_assets_version_idx
  ON design_version_assets(design_version_id);
CREATE INDEX IF NOT EXISTS design_version_assets_asset_idx
  ON design_version_assets(asset_id);

-- design_versions ---------------------------------------------------------
-- Monotonic version_number per ux_upload_id. parent_version_id is NULL
-- for v1. diff_from_parent stores the structural diff JSON (§5.2).
-- The full rendered_design payload sits inline as JSONB.
CREATE TABLE IF NOT EXISTS design_versions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL,
  ux_upload_id        UUID NOT NULL REFERENCES ux_uploads(id),
  version_number      INT NOT NULL,
  parent_version_id   UUID REFERENCES design_versions(id),
  rendered_design     JSONB NOT NULL,
  rendered_design_hash TEXT NOT NULL,
  diff_from_parent    JSONB,
  diff_summary        JSONB,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ux_upload_id, version_number)
);

CREATE INDEX IF NOT EXISTS design_versions_upload_idx ON design_versions(ux_upload_id);
CREATE INDEX IF NOT EXISTS design_versions_tenant_idx ON design_versions(tenant_id);
CREATE INDEX IF NOT EXISTS design_versions_parent_idx ON design_versions(parent_version_id);

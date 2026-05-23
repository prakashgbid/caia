/**
 * SQL fragments used by the snapshotter.
 *
 * Single source of truth so the per-tenant schema name is interpolated in
 * exactly one place. We bind the schema name with a quoted identifier (not
 * a `$1` parameter — Postgres doesn't allow parameterising schema names)
 * after validating it through `assertSafeSchemaName` so injection is
 * impossible.
 *
 * The DDL block (`SCHEMA_SQL`) is shipped here for test bootstrap +
 * documentation. The owning package for the migration is
 * `@chiefaia/meta-schema` per step5 spec §4.
 */

const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

export function assertSafeSchemaName(name: string): void {
  if (!SAFE_IDENT.test(name)) {
    throw new Error(
      `Unsafe schema name: ${JSON.stringify(name)}. Must match /^[a-z_][a-z0-9_]*$/.`,
    );
  }
}

/**
 * Returns a fully-qualified table name. `assertSafeSchemaName` MUST be called
 * upstream — this helper does not re-check.
 */
export function q(schema: string, table: string): string {
  return `"${schema}"."${table}"`;
}

// ---------------------------------------------------------------------------
// DDL — verbatim from step5 spec §4, with column types kept identical.
// ---------------------------------------------------------------------------

export function schemaDDL(schema: string): string {
  assertSafeSchemaName(schema);
  return `
CREATE SCHEMA IF NOT EXISTS "${schema}";

CREATE TABLE IF NOT EXISTS "${schema}"."ux_uploads" (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL,
  business_proposal_id UUID NOT NULL,
  source               TEXT NOT NULL,
  source_metadata      JSONB NOT NULL,
  uploaded_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  rendered_design      JSONB,
  status               TEXT NOT NULL DEFAULT 'uploading',
  parse_diagnostics    JSONB,
  parse_duration_ms    INT,
  failure_reason       TEXT
);

CREATE TABLE IF NOT EXISTS "${schema}"."design_versions" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ux_upload_id        UUID NOT NULL REFERENCES "${schema}"."ux_uploads"(id),
  version_number      INT NOT NULL,
  parent_version_id   UUID REFERENCES "${schema}"."design_versions"(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  diff_from_parent    JSONB,
  diff_summary        JSONB,
  notes               TEXT,
  rendered_design     JSONB,
  UNIQUE (ux_upload_id, version_number)
);

CREATE TABLE IF NOT EXISTS "${schema}"."design_assets" (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ux_upload_id        UUID NOT NULL REFERENCES "${schema}"."ux_uploads"(id) ON DELETE CASCADE,
  design_version_id   UUID NOT NULL REFERENCES "${schema}"."design_versions"(id) ON DELETE CASCADE,
  path                TEXT NOT NULL,
  kind                TEXT NOT NULL,
  content_hash        TEXT NOT NULL,
  storage_url         TEXT NOT NULL,
  size_bytes          BIGINT NOT NULL,
  alt_text            TEXT,
  intrinsic_w         INT,
  intrinsic_h         INT,
  is_placeholder      BOOLEAN NOT NULL DEFAULT false,
  UNIQUE (design_version_id, path)
);

CREATE INDEX IF NOT EXISTS design_assets_hash_idx ON "${schema}"."design_assets"(content_hash);
CREATE INDEX IF NOT EXISTS design_versions_upload_idx ON "${schema}"."design_versions"(ux_upload_id);
`;
}

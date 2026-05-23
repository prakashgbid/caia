# `@caia/atlas-design-snapshotter` changelog

## 0.1.0 — 2026-05-23

Initial release.

- `DesignSnapshotter` class with `captureSnapshot`, `revertToVersion`,
  `getSnapshot`, `listVersions`, `getDiff`, `deleteAllForTenant`.
- Structural diff engine — tree (with stable DOM-ID move detection),
  token, copy, asset, interactivity layers; deterministic JSON output.
- Content-addressed asset dedup via `(tenant_id, content_hash)` UNIQUE.
- BYOC blob adapter contract (`putBlob`, `getBlob`, `headBlob`,
  `deleteBlob`, `deletePrefix`) + in-memory implementation for tests.
- DDL migration `0001_design_versions.sql` for `ux_uploads`,
  `design_assets`, `design_version_assets`, `design_versions` in a
  per-tenant schema.
- 55 unit tests (hash, BYOC, diff, snapshotter end-to-end on fake-pg).
- 9 integration tests against in-process real Postgres (PGlite +
  pgcrypto contrib) — covers JSONB round-trip, UNIQUE constraint,
  ON CONFLICT dedup, JSONB diff persistence, cascade-delete.
- 6 additional integration tests gated on `PG_INTEGRATION_URL` for
  the Docker-Compose Postgres + MinIO lane.

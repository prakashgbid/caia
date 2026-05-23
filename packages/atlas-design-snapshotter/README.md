# `@caia/atlas-design-snapshotter`

> Immutable, content-addressed, parent-linked snapshots of every
> `RenderableDesign` upload. Powers Time Machine + UX Version Control.

This package owns the versioning half of CAIA's Step-5 ingest pipeline
(per `research/step5_design_ingest_spec_2026.md` §4–§5). Every UX upload
ends with a call to `captureSnapshot()`, which writes a `design_versions`
row in the tenant schema (`caia_<short>`), uploads asset blobs via the
tenant's BYOC adapter with content-hash dedup, and records a structural
diff against the parent version so Atlas can render "v3 → v4: 12 changes"
without re-walking the trees.

The design is never overwritten. "Revert to v(N)" is a forward operation:
it creates v(N+1) equal to v(N). No prior row is mutated — the audit
trail stays clean (Architect #15 system contract: every uploaded UX
preserved forever).

## API

```ts
import { DesignSnapshotter, InMemoryBYOCAdapter } from '@caia/atlas-design-snapshotter';
import { Pool } from 'pg';

const snap = new DesignSnapshotter({
  pool: new Pool({ connectionString: process.env.DATABASE_URL }),
  byoc: new InMemoryBYOCAdapter(),                       // swap for R2/S3/GCS in prod
  resolveTenantSchema: async (tid) => `caia_${shortFor(tid)}`,
});

// 1. Capture
const v = await snap.captureSnapshot(uxUploadId, renderableDesign, {
  notes: 'first upload',
});

// 2. Inspect
const list = await snap.listVersions(uxUploadId);
const full = await snap.getSnapshot(v.id);

// 3. Diff
const diff = await snap.getDiff(list[0].id, list[1].id);

// 4. Revert (forward-creates v(N+1) = v(2))
await snap.revertToVersion(uxUploadId, 2, { notes: 'roll back the bad header change' });

// 5. GDPR Article 17
await snap.deleteAllForTenant(tenantId);
```

## Storage

| Table | Purpose |
|---|---|
| `design_versions` | One row per snapshot. Holds `rendered_design jsonb`, `diff_from_parent jsonb`, `parent_version_id`, `version_number`. |
| `design_assets` | Content-addressed dedup by `(tenant_id, content_hash)`. One row per unique byte string per tenant. |
| `design_version_assets` | M:N edge between versions and assets. Carries the path the design referenced the asset under (e.g. `/headshot.jpg`). |
| `ux_uploads` | Owned by `@caia/design-ingest`; the snapshotter only reads it. |

Asset blobs live in the tenant's chosen cloud via the `BYOCBlobAdapter`
contract. Reads, writes, HEAD, single-delete, and prefix-delete are the
five required methods. The in-memory adapter in this package backs all
unit tests; an S3-compatible (MinIO) adapter is used by the integration
suite.

## Integration tests

```sh
docker compose -f docker-compose.test.yml up -d
PG_INTEGRATION_URL=postgres://caia:caia@localhost:54321/caia_test pnpm test:integration
docker compose -f docker-compose.test.yml down -v
```

Vitest covers ≥30 scenarios including creation, parent linkage, every
diff layer (tree/token/copy/asset/interactivity), revert, GDPR delete,
and content-hash dedup (proves `byoc.putCount === 1` when two assets
share bytes).

## Constraints honoured

* **Subscription-only** — zero LLM calls in this package.
* **Pure logic + Postgres + BYOC** — no other services touched.
* **Idempotent** — re-running `deleteAllForTenant` is safe; the unique
  `(ux_upload_id, version_number)` constraint surfaces races as
  `SnapshotterError.code = 'concurrent_version_conflict'`.
* **Immutable** — prior rows are never updated. Revert is forward-only.

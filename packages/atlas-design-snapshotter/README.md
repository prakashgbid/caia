# `@chiefaia/atlas-design-snapshotter`

Captures a **versioned, immutable snapshot of every `RenderableDesign`** at every upload — the Time-Machine and UX-Version-Control primitive that lets architects revert to any prior design state.

**Anchor docs:**
- `research/atlas_module_spec_2026.md` §2 (DOM-ID model), §4 (ticket-versioning analogue)
- `research/step5_design_ingest_spec_2026.md` §1 (`RenderableDesign` shape), §4 (`design_versions` + `ux_uploads` schemas), §5.2 (diff JSON shape), §5.3 (revert SQL)

## What this package does

1. **`snapshot(input)`** — given a freshly-uploaded `RenderableDesign` and the `ux_uploads` row pointer, inserts an immutable `design_versions` row with monotonically increasing `version_number`, `parent_version_id` linked to the prior version, and the `RenderableDesign` JSON. Asset blobs are uploaded via the BYOC adapter with **SHA-256 content-hash dedup** — the same blob across N versions = one upload, N references.
2. **Diff-from-parent** — once a snapshot is created, runs the injected `diffDesigns` (from `@chiefaia/atlas-mapper`) against the parent and persists the result in `design_versions.diff_from_parent` (jsonb) + `design_versions.diff_summary` (jsonb).
3. **`revertToVersion(uxUploadId, versionNumber)`** — the Time-Machine primitive. Creates a new snapshot v(N+1) whose payload equals v(versionNumber). Restoration is always a **forward** operation; prior rows are never mutated.
4. **`deleteAllForTenant(tenantId)`** — GDPR right-to-erasure. Drops all `design_versions` rows + their blobs for the tenant. Idempotent — safe to re-run.
5. **Read APIs.** `getSnapshot`, `listVersions`, `getDiff`.

**Out of scope.** This package does not run agents, does not render iframes, does not call LLMs, does not own the dashboard. It is the pure capture + storage spine that everything else composes around.

## Public API

```typescript
import {
  createDesignSnapshotter,
  type DesignSnapshotter,
  type RenderableDesign,
  type Diff,
  type DesignVersionRow,
  type BlobStorage,
  type PgQueryable,
  type DiffDesignsFn,
} from '@chiefaia/atlas-design-snapshotter';

const snap: DesignSnapshotter = createDesignSnapshotter({
  pg,                          // any node-postgres-compatible client (or fake)
  blobStorage,                 // BYOC adapter: put / get / delete / head
  diffDesigns,                 // injected from @chiefaia/atlas-mapper
  schema: 'caia_pt_dev',       // per-tenant schema name
  tenantId: 'pt-dev',          // tenant identifier
  blobPathPrefix: 'design-assets', // optional; default 'design-assets'
});

// 1. Snapshot on upload
const v = await snap.snapshot({
  uxUploadId: '...',
  design: renderableDesign,
  notes: 'optional commit message',
});
// → { id, versionNumber, parentVersionId, diffSummary, ... }

// 2. Revert
const restored = await snap.revertToVersion({
  uxUploadId: '...',
  versionNumber: 3,
});
// Creates v(N+1) with content from v(3). v(3) is untouched.

// 3. GDPR
const result = await snap.deleteAllForTenant('tenant-id-uuid');
// → { deletedVersionCount, deletedBlobCount }   idempotent

// 4. Reads
const renderable = await snap.getSnapshot(designVersionId);
const versions   = await snap.listVersions(uxUploadId);
const diff       = await snap.getDiff(fromVersionId, toVersionId);
```

## Content-hash dedup

Asset blobs are keyed by `sha256(bytes)`. Before each upload we `head()` the
target path. A hit short-circuits the upload but still inserts a
`design_assets` row pointing at the existing blob. Same image across 50
versions = 1 blob + 50 references.

Blob paths follow the spec §4 convention:
`<blobPathPrefix>/<sha256>` under the tenant's configured prefix. The BYOC
adapter is responsible for tenant isolation (one bucket per tenant in the
default deployment).

## Dependency injection (parameterised public API)

Per the CAIA Option-E shape (AGENTS.md), every external coupling is a
constructor parameter:

| Parameter      | Default in production               | Injected in tests |
| -------------- | ----------------------------------- | ----------------- |
| `pg`           | `new pg.Client(...)`                | `FakePg`          |
| `blobStorage`  | BYOC adapter from `@chiefaia/cloud` | `FakeBlobStorage` |
| `diffDesigns`  | `@chiefaia/atlas-mapper`            | `fakeDiff`        |
| `clock`        | `() => new Date()`                  | frozen clock      |
| `idGen`        | `() => crypto.randomUUID()`         | counter           |

This is what lets us cover every branch with pure in-memory tests and still
share one code path with the integration test against real Postgres + R2.

## Schema migrations

This package **does not own the migration** — `@chiefaia/meta-schema` ships
the per-tenant schema template (step-5 spec §4). For convenience, the
canonical DDL ships at `src/sql.ts`'s `SCHEMA_SQL` constant so a test can
bootstrap a fresh schema by running it.

## Testing

```bash
pnpm --filter @chiefaia/atlas-design-snapshotter test          # all
pnpm --filter @chiefaia/atlas-design-snapshotter test:unit     # in-memory only
pnpm --filter @chiefaia/atlas-design-snapshotter test:integration  # PG + S3
```

The integration test is skipped automatically unless both
`DATABASE_URL` and `S3_ENDPOINT` (plus `S3_BUCKET`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`) are present in the environment.

## Reuse, not invention

- **`RenderableDesign`** — exact shape from `step5_design_ingest_spec_2026.md` §1; type-equivalent to `@chiefaia/atlas-mapper`'s projection.
- **`Diff`** — exact shape from atlas-mapper's `DesignDiff` (flat ID-level: `{added, removed, modified}`).
- **`SecretsAdapter`** — credentials for the BYOC adapter resolve via `@chiefaia/secrets-adapter` at construction time in production. The snapshotter itself never holds secrets.
- **Postgres** — no Drizzle/Prisma coupling. Raw `$1`-style queries against any `PgQueryable` (node-postgres `Client` / `Pool` / our `FakePg`).

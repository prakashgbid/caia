# @caia/design-ingest

Multi-source design-ingest framework — the **Step 5** entry surface for
every external design source CAIA consumes (Claude Design ZIP, Figma JSON,
v0, Lovable, Bolt, Builder.io, Webflow, Framer, Anima).

What it does:

- Declares the `DesignAdapter` contract (`validate / parse / refresh`) per
  `research/step5_design_ingest_spec_2026.md` §3.
- Provides a registry + per-tenant dispatcher so a tenant's
  `preferred_design_source` row picks the right adapter at runtime.
- Owns the `ux_uploads` row lifecycle (`uploading → parsing → parsed |
  failed`) and orchestrates the validate-then-parse-then-capture sequence
  via `Ingestor.ingest()`.
- Wraps `@caia/atlas-design-snapshotter.captureSnapshot` so every
  successful parse lands as an immutable, parent-linked `design_versions`
  row with content-addressed assets via the BYOC blob store.
- Delegates stable DOM-ID assignment to
  `@chiefaia/atlas-mapper.assignStableDomIds` — the framework never
  computes DOM IDs itself.
- Coordinates GDPR Article 17 right-to-erasure across `ux_uploads`,
  `design_versions` (via the snapshotter), and tenant secrets (via
  `@caia/secrets-adapter.deleteAllForTenant`).

What it does **NOT** do:

- Parse any particular source format. That's the per-source adapter's
  job — e.g. `@caia/design-ingest-adapter-cd-zip` for ZIP exports.
- Own the `design_versions` / `design_assets` tables. Those belong to
  `@caia/atlas-design-snapshotter`.
- Run LLM calls.

## Public surface (high-level)

```ts
import {
  DesignAdapter,
  DesignAdapterCtor,
  AdapterInput,
  AdapterDeps,
  AdapterCapabilities,
  ValidationResult,
  RenderableDesignSchema,
  Ingestor,
  registerAdapter,
  getDesignAdapterForTenant,
  UxUploadsRepo,
  GdprCoordinator,
  ProviderNotSupported,
  RefreshNotSupported,
  NotImplementedError,
  IngestionError,
} from '@caia/design-ingest';
```

## Persistence

| Table              | Owner                           |
|--------------------|---------------------------------|
| `ux_uploads`       | `@caia/design-ingest`           |
| `design_versions`  | `@caia/atlas-design-snapshotter`|
| `design_assets`    | `@caia/atlas-design-snapshotter`|
| `design_version_assets` | `@caia/atlas-design-snapshotter` |

The snapshotter's migration creates `ux_uploads` as an FK target. This
package ships an idempotent copy in `migrations/0001_ux_uploads.sql`
for installations that run design-ingest before the snapshotter
migration applies.

## Tenant schema strategy

The framework is schema-agnostic — every public method accepts a
`resolveTenantSchema(tenantId): string | Promise<string>` callback so
production wires it to the `caia_meta.tenants.short_id` lookup and
tests default to `public`. Mirrors `@caia/atlas-design-snapshotter`.

## Status

`v0.1.0` — framework implementation. CD ZIP adapter ships in
`@caia/design-ingest-adapter-cd-zip` (scaffold this PR, full
implementation in a follow-up).

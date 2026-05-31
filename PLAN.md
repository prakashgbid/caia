# `apps/wizard` + events-taxonomy — GDPR rights surface (WIZARD-B8)

**Author:** cowork-mode-claude-phase-b-ui (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/wizard-b8-gdpr-rights-surface-2026-05-31`
**True-Zero admin-merge:** Subscription-only, build-phase carve-out applies.

## 1. Why this exists

Phase B Task B8 of the CAIA wizard pipeline: customers need a
first-class UI surface for their GDPR Article 15 (right of access)
and Article 17 (right to erasure) entitlements. B8 ships the page
plus the two API routes plus the cascade event so the wizard is
audit-defensible the day it goes live.

## 2. Shape

```
apps/wizard/app/settings/privacy/page.tsx                       # /settings/privacy
apps/wizard/components/wizard/PrivacyRightsPanel.tsx            # client panel
apps/wizard/app/api/settings/privacy/export/route.ts            # POST export
apps/wizard/app/api/settings/privacy/erase/route.ts             # POST erase
apps/wizard/tests/wizard-shell/privacy-rights.test.tsx          # 18 vitest cases
apps/wizard/tests/wizard-shell/registry-yaml-tenant-erased.test.ts  # 4 vitest cases
apps/wizard/tests/wizard-shell/privacy-export.spec.ts           # 1 Playwright E2E (gated)
packages/events-taxonomy-internal/registry.yaml                 # +tenant.erased event
packages/events-taxonomy-internal/index.ts                      # +EventType + EVENT_SEVERITY
```

## 3. Surface behaviour

### Export — GDPR Article 15
- Button POSTs `/api/settings/privacy/export`.
- Route reads `x-tenant-id` (Cloudflare Access header), returns 401 when missing.
- Response body is a stable JSON envelope:
  ```
  {
    schema_version: '1',
    tenant_id, exported_at_iso,
    wizard:            { projects: [...] },
    ia_artifacts:      [...],
    design_uploads:    [...],
    interview_threads: [...],
    business_proposals: [...]
  }
  ```
- Response also sets `Content-Disposition: attachment` so the browser
  triggers a download. The client component uses a `Blob` + temporary
  anchor (default `downloadImpl`) so unit tests can inject a spy that
  captures the filename + content without touching jsdom's URL polyfill.

### Erase — GDPR Article 17
- Button opens a `@caia/ui` Dialog with a confirmation input.
- User must type the literal word `ERASE` (case-sensitive) before the
  Confirm button POSTs to `/api/settings/privacy/erase`.
- Route returns 400 when confirmation is missing or wrong.
- Stub path (default) returns `{ ok: true, source: 'memory',
  cascade: { ux_uploads_deleted, secrets_workspace_deleted,
  schema_dropped, audit_logged, event_published } }` so the client UX
  is identical to live mode.
- Live path (gated on `WIZARD_PRIVACY_ERASE_LIVE=1`) currently returns
  503 with `erase-live-not-implemented` — the full cascade with
  `@caia/design-ingest.GdprCoordinator.deleteAllForTenant` +
  Infisical workspace deletion via `@caia/secrets-adapter` + Postgres
  schema DROP + `tenant.erased` NATS publish ships in a Wave-2
  follow-up that wires the right per-tenant context. Documented inline.

### `tenant.erased` event
- New `tenant.erased` type registered in
  `events-taxonomy-internal/registry.yaml` with severity `warning`,
  actors `[api, user, system]`, and payload
  `[tenant_id, email, schema_name, ux_uploads_deleted,
  secrets_workspace_deleted, schema_dropped, occurred_at_iso]`.
- Added to the `EventType` union + `EVENT_SEVERITY` map in
  `events-taxonomy-internal/index.ts` so consumers can subscribe via
  the canonical type-safe surface.

## 4. Reuse-first

| Need | Existing package consumed |
|---|---|
| Card + Button + Dialog primitives | `@caia/ui` |
| Badge for `Art. 15` + `Art. 17` tags | `@caia/ui` |
| Event registration | `@chiefaia/events-taxonomy-internal` |
| Future cascade | `@caia/design-ingest.GdprCoordinator` (existing in v0.1.0) |

No raw shadcn/Radix imports. No third-party Dialog. No parallel event
taxonomy.

## 5. Subscription-only

No LLM calls. The route is destructive — the live cascade goes through
the canonical `@caia/design-ingest.GdprCoordinator` and the Infisical
adapter from `@caia/secrets-adapter`. The capability-broker gating
ships in a sibling PR; for now the Cloudflare Access-protected tenant
boundary the wizard already enforces is the authorisation surface.

## 6. Tests

- 18 vitest cases in `tests/wizard-shell/privacy-rights.test.tsx`:
  panel rendering (3), export flow (3), erase dialog (4), erase POST (2),
  export route (3), erase route (3).
- 4 vitest cases in `tests/wizard-shell/registry-yaml-tenant-erased.test.ts`:
  type registered, severity warning, actor list, payload list.
- 1 Playwright E2E in `tests/wizard-shell/privacy-export.spec.ts`:
  `Export my data button triggers a download`. Gated on
  `WIZARD_E2E_BASE_URL`; skipped in CI to keep the unit-test runner
  fast.

22 new vitest cases total. Brief requested ≥15.

Whole wizard suite: 356/356 pass. Pre-existing develop failures
(TS2352 + lighthouse warn-only) unchanged.

## 7. True-Zero readiness

- Privacy tests `pnpm exec vitest run` → 22/22 pass.
- Whole wizard suite → 356/356 pass.
- Local `tsc --noEmit` clean for B8 files.
- No raw shadcn/Radix imports outside `packages/ui/**`.
- Branched from `origin/develop` (HEAD b67162c — B6 merged).

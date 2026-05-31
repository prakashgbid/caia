# `@caia/design-ingest` + `apps/wizard` — real Claude design adapter (WIZARD-B2)

**Author:** cowork-mode-claude-phase-b-ui (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/wizard-b2-real-claude-design-adapter-2026-05-31`
**True-Zero admin-merge:** Subscription-only, build-phase carve-out applies.

## 1. Why this exists

Phase B Task B2 of the CAIA wizard pipeline: the Step 6 (Design) flow
had a stub Claude integration. The DesignPanel UI offered "paste this
prompt into your design tool, then upload the result as a CD ZIP" —
the inverse round-trip the spec wanted to close. The actual Claude
generation lived in a `// Wave 2 wires the actual @caia/design-ingest
Ingestor here` placeholder.

B2 closes the loop: given the Step-5 design-app prompt, the system
itself spawns Claude (subscription-only, via `@chiefaia/claude-spawner`)
and parses the JSON envelope into a `RenderableDesign`. The wizard
exposes this through a new `POST /api/wizard/design/ingest` route
that composes the canonical backend wrapper chain
(`withTenantSearchPath → wizardWithRetry → withClaudeSpawnerSpan`)
around the new adapter.

## 2. Shape

```
packages/design-ingest/src/claude-design-adapter.ts   # new adapter
packages/design-ingest/src/schema.ts                  # +'claude-design' source name
packages/design-ingest/src/errors.ts                  # +7 B2 error codes
packages/design-ingest/src/index.ts                   # export ClaudeDesignAdapter
packages/design-ingest/package.json                   # +@chiefaia/claude-spawner dep + updated description
packages/design-ingest/tests/unit/claude-design-adapter.test.ts   # 15 vitest cases
packages/design-ingest/tests/unit/schema.test.ts      # updated count assertion
apps/wizard/app/api/wizard/design/ingest/route.ts     # new POST route
apps/wizard/tests/wizard-shell/wizard-steps/design-ingest-route.test.ts  # 12 vitest cases
```

`ClaudeDesignAdapter` implements `DesignAdapter`:
- `validate(input)` — cheap shape check (kind, promptText, designVersionId).
- `parse(input)` — spawns Claude with a `--output-format=json` argv,
  parses the envelope via the canonical `parseClaudeJsonEnvelope`,
  parses `envelope.result` as JSON, validates against
  `RenderableDesignSchema` (Zod), returns the `RenderableDesign`.
- `refresh()` — throws `RefreshNotSupported` (claude-design is one-shot).
- `capabilities` — `requiresCredential: false` (the keychain OAuth
  session is the credential), `supportsRefresh: false`,
  `supportsLiveWebhook: false`.

Test seams (`spawnImpl`, `parseEnvelopeImpl`) keep the suite away
from a real subprocess. Production paths default to the canonical
`spawnClaude` + `parseClaudeJsonEnvelope` from `@chiefaia/claude-spawner`.

## 3. Reuse-first

| Need | Existing package consumed |
|---|---|
| Claude binary spawn (subscription-only) | `@chiefaia/claude-spawner.spawnClaude` |
| Envelope parsing | `@chiefaia/claude-spawner.parseClaudeJsonEnvelope` |
| RenderableDesign schema validation | `@caia/design-ingest.assertRenderableDesign` (Zod) |
| Retry/backoff envelope | `apps/wizard/lib/wizard/retry-spawner.wizardWithRetry` (B7) |
| Tempo semantic span | `@chiefaia/tracing.withClaudeSpawnerSpan` (B3) |
| Tenant schema pinning | `apps/wizard/lib/tenants/search-path.withTenantSearchPath` (B4) |

No parallel Claude spawn. No bespoke envelope parser. No parallel
retry/backoff. No raw `child_process.spawn`. No raw `axios`/`fetch`
to api.anthropic.com.

## 4. Subscription-only

`@chiefaia/claude-spawner.spawnClaude` unconditionally scrubs
`ANTHROPIC_API_KEY` + sibling API-key env vars (see `SCRUBBED_AUTH_ENV_VARS`).
The binary falls through to the keychain OAuth subscription session.
There is no fallback to API-key billing — `spawnClaude` returns
`ok: false` if the binary fails, and the route surfaces that as a 503.

## 5. Tests

- 15 adapter unit tests in `packages/design-ingest/tests/unit/claude-design-adapter.test.ts`
  covering: validate (5 cases — happy/upload-kind/missing-prompt/whitespace-prompt/missing-dv),
  parse success (2 cases — clean envelope + threaded model/timeout),
  parse failure (5 cases — spawn-failed/envelope-invalid/result-not-json/schema-invalid/refresh-not-supported),
  contract (1 case — sourceName + subscription-only capabilities),
  prompt builder (2 cases — designVersionId + promptText inlined).
- 12 route unit tests in `apps/wizard/tests/wizard-shell/wizard-steps/design-ingest-route.test.ts`
  covering: route contract (runtime/dynamic), validation (4 cases —
  bad-json/missing-projectId/missing-prompt/whitespace-prompt), auth
  (1 case — 401 when x-tenant-id missing), stub path (5 cases —
  default returns memory/uses-supplied-dv/generates-dv/note-points-at-env/idempotent).
- 27 tests total. The brief requested ≥10.
- 1 updated test in `packages/design-ingest/tests/unit/schema.test.ts`
  to reflect the source-count bump from 9 → 10.

All 68 design-ingest tests pass + new wizard route tests pass.

Pre-existing develop failures (`@chiefaia/tracing` dist missing
`withClaudeSpawnerSpan` because the package is consumed via
`workspace:*` + pnpm doesn't rebuild on every install + TS2352 in
`tests/wizard-shell/edge-bypass.test.ts`) are unchanged — same
tolerated set the backend B wave merged through.

## 6. True-Zero readiness

- Adapter `pnpm exec vitest run` → 15/15 pass.
- Route `pnpm exec vitest run` → 12/12 pass.
- Whole-package `pnpm exec vitest run` (design-ingest) → 68/68 pass.
- Local `tsc --noEmit` → only pre-existing tracing-dist error remains.
- No raw shadcn/Radix imports anywhere (B2 is server-side only — no
  client component changes).
- Branched from `origin/develop` (HEAD 2e66908 — B1 merged).

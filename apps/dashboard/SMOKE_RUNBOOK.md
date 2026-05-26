# Live Wizard Smoke — Operator Runbook

End-to-end smoke that walks all 7 wizard steps for a fictional project
against the **live** `dashboard.chiefaia.com` deployment. Produces a
structured pass/fail report per step.

This is the integration-test signal for "is the wizard live-demoable
yet?". On the day the smoke framework lands (PR
`feature/live-wizard-smoke-2026-05-25`), this is **expected** to fail
somewhere in the walk — that's the value. Where it fails is the current
"live demo readiness" boundary.

---

## 1. What this smoke is

| Slot                    | Value                                                          |
| ----------------------- | -------------------------------------------------------------- |
| Spec                    | `apps/dashboard/tests/e2e/live-wizard-smoke.spec.ts`           |
| Config                  | `apps/dashboard/playwright.live-smoke.config.ts`               |
| Auth helper             | `apps/dashboard/tests/e2e/setup-cloudflare-access.ts`          |
| Run script              | `apps/dashboard/scripts/run-live-smoke.sh`                     |
| CI workflow             | `.github/workflows/live-wizard-smoke.yml` (nightly + dispatch) |
| Fixtures                | `apps/dashboard/tests/e2e/fixtures/`                           |
| Default target          | `https://dashboard.chiefaia.com`                               |
| Default operator email  | `prakash.stolution@gmail.com`                                  |

The smoke runs as a single Playwright test with one `test.step()` per
wizard step, so the HTML report has a row per step with timing,
screenshot, and trace. Screenshots are captured at every step transition
to `apps/dashboard/test-results-live-smoke/`.

---

## 2. Prerequisites

### 2.1 Cloudflare Access auth

The dashboard is gated by the Cloudflare Access app id
`cb6d1de5-2ab6-4860-af9e-7395ca0a8381` (allowlists
`prakash.stolution@gmail.com`). The smoke supports two non-interactive
auth modes — set **one** of these:

Mode A — storageState (preferred for local-operator runs):

```bash
# Capture once. Opens a real Chromium; sign in interactively when prompted.
pnpm --filter @caia-app/dashboard exec \
  tsx tests/e2e/setup-cloudflare-access.ts --capture

# Then export for subsequent runs:
export PLAYWRIGHT_STORAGE_STATE=./apps/dashboard/tests/e2e/.auth/live-state.json
```

CF Access cookies default to 24h; the smoke prompts to re-capture when
the first request bounces to `/sign-in`.

Mode B — service-token (preferred for CI):

```bash
# Generate in Cloudflare Zero Trust -> Access -> Service Auth -> Service Tokens
export CF_ACCESS_CLIENT_ID=<id>
export CF_ACCESS_CLIENT_SECRET=<secret>
```

Service tokens are long-lived — set them as GitHub secrets for the
nightly CI run.

### 2.2 Optional: direct Postgres for FSM assertions

```bash
# Port-forward chiefaia-postgres for the duration of the smoke run.
kubectl port-forward -n chiefaia svc/chiefaia-postgres 5432:5432 &

# Get the connection string (or pull from Infisical chiefaia.dashboard.database-url).
export LIVE_SMOKE_DATABASE_URL='postgresql://<user>:<pass>@localhost:5432/chiefaia'
```

When unset, Postgres assertions are skipped with a warning and the
smoke just walks the UI.

### 2.3 Optional: Tempo for Claude-call trace assertions

```bash
# Port-forward Tempo's HTTP API (port 3200).
kubectl port-forward -n chiefaia svc/tempo 3200:3200 &
export LIVE_SMOKE_TEMPO_URL=http://localhost:3200
```

When unset, trace assertions are skipped.

---

## 3. Running

```bash
cd <repo-root>
./apps/dashboard/scripts/run-live-smoke.sh
```

Useful pass-through args (anything after the script name is forwarded
to `playwright test`):

```bash
# Re-run in headed mode so the operator can watch the wizard walk.
./apps/dashboard/scripts/run-live-smoke.sh --headed

# Step-debug — pauses at each step transition.
./apps/dashboard/scripts/run-live-smoke.sh --debug

# UI mode — the Playwright trace viewer (best for failure forensics).
./apps/dashboard/scripts/run-live-smoke.sh --ui
```

After the run:

- HTML report: `apps/dashboard/playwright-report-live-smoke/index.html`
- JSON report: `apps/dashboard/playwright-report-live-smoke/results.json`
- Screenshots + traces: `apps/dashboard/test-results-live-smoke/`

---

## 4. Step-by-step interpretation

Each step is logged to stdout with the prefix `[live-smoke]`. Use this
matrix to map a failure to its likely root cause.

### Step 0 — Sign-in + tenant provisioning

| Symptom                                | Likely cause                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Landed on `/sign-in`                   | CF Access auth didn't carry. Re-capture storageState or rotate the service-token.                                                         |
| HTTP 503 `no healthy upstream`         | `chiefaia-dashboard` Deployment is not Ready. Blocks at A1+A2. Check `kubectl get pods -n chiefaia -l app=chiefaia-dashboard`.             |
| HTTP 503 `tenant-provisioning-failed`  | Middleware ran provisioning but errored. Check dashboard pod logs for `[provisionTenant]`. Often Infisical-reachability or pg pool.       |
| Postgres `tenants` row never appears   | `provisionTenant()` did not commit. Check the global `tenants` table directly, and `tenant_provision_attempts` for failure reasons.       |

### Step 1 — Onboarding (`/wizard/onboarding`)

| Symptom                                | Likely cause                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `wizard-step-onboarding` testid missing | Step 1 page not deployed. Blocks at A4.                                                                     |
| Form fields not present                | A4 ships the port of the admin onboarding form into the customer wizard — likely pre-A4.                    |
| No `tenant_projects` row after submit  | The OnboardingEngine.submit() didn't write — check dashboard logs for the `/api/wizard/onboarding` handler. |

### Step 2 — Grand Idea (`/wizard/grand-idea`)

| Symptom                              | Likely cause                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `wizard-step-grand-idea` not visible | Step 2 page not deployed. Blocks at A5.                                                                      |
| `grand-idea-form` not visible        | The form bridge from PR #610 didn't deploy.                                                                  |
| FSM not in `idea-captured`           | The `/api/wizard/grand-idea` handler didn't call `advanceToIdeaCaptured()`. Check `tenant_state_transitions`. |

### Step 3 — Interview (`/wizard/interview`)

Slug is `interview` (NOT `interviewer`). Step 3 calls
`@chiefaia/claude-spawner` in subscription-only mode (ADR-001) with the
16-pillar / 364-question playbook.

| Symptom                                          | Likely cause                                                                                                   |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Chat UI never mounts                             | Step 3 page not deployed. Blocks at A6.                                                                        |
| First question never arrives                     | Spawner failed to start. Check Tempo for the `interviewer/claude.spawn` span and the pod logs.                 |
| `/api/interview/<projectId>/complete` returns 404| The operator-complete endpoint isn't shipped yet — the smoke can't force-complete; this is non-blocking today. |
| FSM never reaches `interview-complete`           | Completeness score < 80 (default gate). Inspect `business_plan_v2` JSONB for the score.                        |

### Step 4 — Information Architect (`/wizard/architecture`)

Slug is `architecture` (NOT `info-architect`). Step 4 calls Claude with
`claude-opus-4-6`, 120s timeout. Outputs land in three tables:
`pages_catalogue`, `design_tokens`, `components_library`.

| Symptom                              | Likely cause                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `wizard-step-architecture` missing   | Step 4 page not deployed. Blocks at A7.                                                                            |
| Generate never returns               | IA agent timed out (120s) or failed the critic loop. Check `information-architecture-failed` rows and Tempo trace. |
| pg `pages_catalogue` row count = 0   | Spawner returned but persistence didn't write. Check the IA handler logs.                                          |
| Tempo trace for `info-architect`=0   | OTel SDK on the IA service didn't initialise. Verify `@chiefaia/tracing` is imported + `initTracing()` was called. |

### Step 5 — Proposal (`/wizard/proposal`)

PR #610 ships this page; once the proposal generator is wired to live IA
outputs (B-phase task), the testids stay the same.

| Symptom                                                | Likely cause                                                  |
| ------------------------------------------------------ | ------------------------------------------------------------- |
| `generate-proposal` button missing                     | PR #610 didn't deploy. Re-deploy the dashboard.               |
| `renderer-exec` / `renderer-full` / `renderer-onepager` not visible after click | Renderer JS bundle didn't ship. Check the dashboard build.    |
| Pandoc rendering fails (PDF/DOCX errors in logs)       | Dashboard container lacks Pandoc. Blocks at A1 (Dockerfile).  |

### Step 6 — Design (`/wizard/design`)

PR #610 ships the copy-prompt UI; A9 wires the real `Ingestor.ingest()`
call. Until A9 lands, the file input may exist but no row in `ux_uploads`
will appear.

| Symptom                                | Likely cause                                                                |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `design-prompt-text` missing           | PR #610 didn't deploy.                                                      |
| No `input[type=file]` in dialog        | Upload UI not wired. Blocks at A9.                                          |
| Upload click but no `ux_uploads` row   | A9 not yet wired — the page only patches FSM and skips `Ingestor.ingest()`. |

### Step 7 — Atlas (`/wizard/atlas/<projectId>`)

PR #610 ships the page with `createMockClient()` from
`@caia/atlas-ui/fixtures` — the iframe + ticket pane render against
fixtures until A10 lands.

| Symptom                          | Likely cause                                                  |
| -------------------------------- | ------------------------------------------------------------- |
| `wizard-step-atlas` missing      | PR #610 didn't deploy.                                        |
| No iframe present                | The design preview iframe needs a snapshot URL — blocks at A10. |
| Zero tickets in left pane        | Atlas Prompt Router not handling live requests — blocks at A10. |

### Final assertion — `wizard_state.current_slug = 'atlas'`

The spec logs the final wizard_state row but does NOT hard-fail on
day-1 (the failure is informative — the smoke is the demo-readiness
gauge). To convert to a hard assertion once A1-A10 ship, replace the
soft-warn at the bottom of the spec with:

```ts
expect(ws!.current_slug).toBe('atlas');
expect(ws!.current_step_idx).toBe(7);
```

---

## 5. Tempo trace inspection

When `LIVE_SMOKE_TEMPO_URL` is set, the smoke logs whether a Claude
spawn trace was found for each LLM step. To inspect manually:

```bash
# Service-name tags emitted by @chiefaia/tracing per package:
#   interviewer
#   info-architect
#   business-proposal-generator
#
# Span name for the Claude call: claude.spawn

curl "$LIVE_SMOKE_TEMPO_URL/api/search?tags=service.name=interviewer%20name=claude.spawn&limit=5" | jq .

# Then fetch a trace by ID:
curl "$LIVE_SMOKE_TEMPO_URL/api/traces/<traceID>" | jq .
```

Grafana dashboard for traces: `infra/grafana/dashboards/caia-traces.json`.

---

## 6. Common failure modes

| Failure                                                              | Triage                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Smoke times out at 30 min                                            | One step hung — check the last screenshot in `test-results-live-smoke/`. Usually a Claude-call timeout. |
| Step succeeds in UI but pg row missing                               | Per-tenant migration didn't apply. Check A3 — the migration runner must subscribe to `tenant.provisioned`. |
| `SET search_path` errors with `schema "tenant_<slug>" does not exist`| `ensureTenantSchema()` failed during provisioning. Re-run provisioning manually.                        |
| Postgres connection refused                                          | Port-forward dropped — restart `kubectl port-forward`.                                                  |
| `CF-Access-*` headers ignored — bounce to `/sign-in`                 | Service token rotated or the Access policy changed. Regenerate in Zero Trust dashboard.                 |

---

## 7. Promoting the smoke from informative to blocking

Once A1-A10 land and the smoke is green end-to-end:

1. Replace the soft-warn at the bottom of `live-wizard-smoke.spec.ts`
   with the hard `expect()` shown in section 4.
2. In `.github/workflows/live-wizard-smoke.yml`, change
   `continue-on-error: true` -> `false` for the smoke job.
3. Wire a Slack notification on failure to the chiefaia status channel
   (replace the placeholder webhook URL).

---

## 8. Subscription-only discipline (ADR-001)

The smoke does NOT trigger API-key billing on Claude. Every LLM step
goes through `@chiefaia/claude-spawner` in subscription mode. If you
see `429` or `Pay-as-you-go` in the spawner logs, the dashboard
configuration drifted — check `CLAUDE_SPAWNER_MODE=subscription` in the
chiefaia-dashboard ConfigMap.

---

## 9. Schema notes — gap-analysis vs reality

A few names differed between the original Phase A11 spec and the
actually-shipped code. The smoke uses the actually-shipped names:

| Asked for                  | Actual (in code)                                              |
| -------------------------- | ------------------------------------------------------------- |
| `chiefaia_meta.tenants`    | `public.tenants` (see `migrations/0011_tenants_global.sql`)   |
| step slug "info-architect" | `architecture` (see `lib/wizard/steps.ts` WIZARD_STEPS)       |
| step slug "interviewer"    | `interview`                                                   |
| `wizard_state.completed_steps` (column) | column does not exist; FSM history lives in `tenant_state_transitions` (managed by `@caia/state-machine`). Final assertion uses `current_slug`/`current_step_idx` instead. |

When these names change in code, update the spec + this runbook in the
same PR.

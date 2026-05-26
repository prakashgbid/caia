# `apps/dashboard` — Wizard shell + Cloudflare Access auth + tenant provisioning

**Author:** autonomous-build (operator-dispatched 2026-05-25)
**Status:** Implementation
**ADR refs:** ADR-024 (IA Step 3.5), ADR-061 (canonical `@caia/ui`), ADR-065 (reuse-first as enforced discipline)
**Branch:** `feature/wizard-shell-auth-foundation-2026-05-25`
**True-Zero admin-merge:** RATIFIED via PR #587 carve-out (`.caia/build-phase-active` present).

## 1. Why this exists

The dashboard previously had no auth gate, no tenant resolution, no wizard chrome, and no FSM-driven state hydration. Stories sit on three sibling branches: PR #594 landed the Information-Architecture FSM states inside `@caia/state-machine`; PR #597 shipped `@caia/ui` as the canonical primitive library; PR #599+#600 ratified the reuse-first gates (Semgrep + EA-gate + reuse-advisory-blocking CI). This PR is the **foundation** that lets per-step UI work (`onboarding`, `grand-idea`, `interview`, `architecture`, `proposal`, `design`, `atlas`) plug into a real frame.

Concretely:

- Every dashboard route must require a **Cloudflare Access** JWT before rendering. Today there is no middleware.
- Every authed request must resolve to a **tenant**. Today there is no tenant table.
- A new tenant's **per-tenant Postgres schema + Infisical workspace** must be created on first sign-in. Today there is no provisioning path.
- The **wizard** is the centerpiece of CAIA's customer-facing flow — 7 steps mapped to the canonical FSM. Today there is no wizard layout.
- The wizard must hydrate from `@caia/state-machine`'s `ProjectState` so the indicator + per-step gating match the FSM source of truth.

## 2. Scope of this PR

### 2.1 In scope

1. **Cloudflare Access middleware** — `apps/dashboard/middleware.ts`. Reads `CF_Authorization` cookie; verifies via 5-min-TTL JWKS cache built on `jose`; redirects to `/sign-in` on miss; attaches `x-tenant-id` + `x-tenant-email` headers downstream.

2. **Tenant provisioning fan-out** — `apps/dashboard/lib/tenants/{store.ts,infisical.ts,provision.ts,wire.ts}`. `provisionTenant(email, displayName)`:
   - Fast-path: returns existing row from global `tenants` table.
   - Otherwise: creates per-tenant Postgres schema, calls Infisical V2 workspace-create API at `infisical.chiefaia.com`, inserts to global `tenants` (`ON CONFLICT (email) DO NOTHING`), publishes `tenant.provisioned` to NATS via `@chiefaia/event-bus-nats`.
   - Idempotent at every layer. Only the first writer publishes.

3. **Wizard shell** — `app/wizard/layout.tsx` (server component using `@caia/ui` Card + Progress) + `components/wizard/WizardNav.tsx` (client component with live step indicator + Back/Next buttons using `@caia/ui` Button). 7 steps catalogued in `lib/wizard/steps.ts`, FSM-state-aware via `stepIndexForState()`.

4. **Step router** — `app/wizard/[step]/page.tsx`. Slug→step lookup; renders a "Coming soon" `@caia/ui` Card for any step whose dedicated component lands later. Unknown slugs 404.

5. **Sign-in** — `app/sign-in/page.tsx` (Cloudflare-Access redirect target, `@caia/ui` Card surface).

6. **Wizard state surface**:
   - `lib/wizard/state.ts` — `useWizardState(projectId)` client hook (SWR-backed, 5s revalidation).
   - `lib/wizard/state.server.ts` — `getWizardState(projectId, {store})` server helper. Pure async; no React.
   - `lib/wizard/store-wire.ts` — per-tenant `StateStore` factory using `@caia/state-machine`'s `PgStateStore`.
   - `app/api/wizard/[projectId]/state/route.ts` — GET returns snapshot; PATCH validates FSM transition via `@caia/state-machine`'s `canTransition` then dispatches the actual transition through `StateMachine.transition`.

7. **Tenant API** — `app/api/tenant/me/route.ts`. Returns the current tenant row from headers.

8. **Migrations** — `migrations/0010_wizard_state.sql` (per-tenant) + `migrations/0011_tenants_global.sql` (global lookup + provisioning-attempt audit).

9. **Event registry** — adds `tenant.provisioned` to `packages/events-taxonomy-internal/registry.yaml` with the four-field payload (`tenant_id`, `email`, `schema_name`, `infisical_project_id`).

10. **Tests** — 60+ vitest cases (JWKS cache, CF Access loader, tenant store, provisioning idempotency + fan-out, Infisical client, wizard steps, server-side state helper, registry-yaml shape, migrations shape) + Playwright E2E (`tests/wizard-shell/e2e.spec.ts`) covering unauthed-redirect, sign-in render, step-1 hydration, unknown-slug 404.

### 2.2 Deferred (Wave 2)

- Per-step components for `onboarding`, `grand-idea`, `interview`, `architecture`, `proposal`, `design`, `atlas`. Each step is its own sibling PR (interview + architecture already underway on `feature/wizard-steps-3-4-2026-05-25`).
- Edge-runtime middleware split — V1 uses `nodejs` runtime because `pg` + `nats` are needed in the same trip. Wave 2 will split provisioning into a Node-runtime route handler so the edge can stay lean. See file-header comment in `middleware.ts`.
- Cross-tenant audit log on `/api/wizard/[projectId]/state` (tenant isolation today relies on per-tenant schema; explicit project-belongs-to-tenant check is a follow-up).
- Infisical orphan-workspace janitor — Wave 1 relies on `@caia/devops-runtime`'s daily reconciliation cron to catch the rare race where two concurrent provisions create two workspaces but one tenant row.
- `@chiefaia/http-client` adoption — Wave 1 uses native `fetch` for the Infisical V2 workspace-create call. Swap when that package ships.
- `@chiefaia/persistence-postgres` adoption — Wave 1 uses raw `pg` driver. Swap when that package ships.

## 3. Reuse-first compliance

Per ADR-065 / AGENTS.md > Reuse-first, every helper/type/UI primitive was checked against the workspace before writing inline code. See §4 for the structured `reuseSearchResults` payload submitted with this plan.

Mechanical gates expected to pass:

- **Semgrep `caia-no-raw-shadcn-import-outside-ui-package`** — zero raw shadcn imports in this PR; everything is `from '@caia/ui'`.
- **Semgrep `caia-no-raw-radix-outside-ui-package`** — zero raw Radix imports.
- **Semgrep `caia-no-inline-tailwind-in-customer-facing-app`** — components use inline `style={...}` for layout-only wrappers; the visible primitives (Card, Button, Progress) come from `@caia/ui` and own their Tailwind. WARNING-only rule; no failures.
- **Semgrep `caia-no-raw-axios-outside-http-client`** — zero axios imports; Infisical client uses native `fetch`.
- **Semgrep `caia-no-raw-better-sqlite3-outside-persistence`** — no SQLite usage; Postgres only.
- **`reuse-advisory-blocking` CI gate** (`scripts/reuse-check-strict.js`) — same regex coverage, same expected outcome.
- **EA gate** (`@caia/reuse-check-gate`) — this PLAN is submitted via `submitPlanWithReuseGate` (see `scripts/submit-plan.mjs`) with the populated `reuseSearchResults` field below.

## 4. Reuse search results

| Package | Considered? | Decision | Reason |
|---|---|---|---|
| `@caia/ui` | yes | **selected** | Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Progress all present. Used in `app/wizard/layout.tsx`, `app/wizard/[step]/page.tsx`, `app/sign-in/page.tsx`, `components/wizard/WizardNav.tsx`. |
| `@caia/state-machine` | yes | **selected** | `ProjectState` type + `canTransition` + `StateMachine` + `PgStateStore` used for wizard state lookups + transitions. IA states from PR #594 are first-class. |
| `@chiefaia/event-bus-nats` | yes | **selected** | Publishes `tenant.provisioned` after first-touch provisioning. |
| `@chiefaia/events-taxonomy-internal` | yes | **selected** | New event registered in `registry.yaml`. |
| `@caia/secrets-infisical` | yes | **rejected** | Wraps the secrets *data* API (read/write per-secret). Workspace *creation* is admin-API territory not in this package's surface yet. Tracked as a follow-up to extend it. |
| `@chiefaia/http-client` | yes | **rejected** | Not yet shipped on develop. Native `fetch` used in `lib/tenants/infisical.ts`; swap when wrapper lands. Reuse-check-strict + Semgrep both allow `fetch`. |
| `@chiefaia/persistence-postgres` | yes | **rejected** | Not yet shipped on develop. Raw `pg` used; reuse rules don't forbid it. Swap when wrapper lands. |
| `@chiefaia/claude-spawner` | yes | **rejected** | No LLM calls in this PR (auth + provisioning + shell only). Subscription-only discipline trivially satisfied. |
| `@caia/grand-idea` | yes | **rejected** | Step 2 (idea capture) ships its own UI on a sibling branch; foundation PR only renders the wizard *shell*, not step 2 content. |
| `@caia/info-architect` | yes | **rejected** | Step 4 (IA) ships its own UI on a sibling branch; foundation PR only catalogues its FSM states inside `lib/wizard/steps.ts`. |
| `@caia/interviewer` | yes | **rejected** | Step 3 ships its own UI on a sibling branch. Same rationale. |
| `@caia/architect-kit` | yes | **rejected** | Used by architect packages, not by auth/tenant infra. |
| `@chiefaia/logger`, `@chiefaia/errors`, `@chiefaia/config`, `@chiefaia/metrics`, `@chiefaia/tracing` | yes | **rejected** | Wave 1 uses bare `console.error` + thrown `Error` instances for failure paths. Wave 2 will adopt the canonical wrappers once the dashboard's logging surface settles. |
| `next` server primitives (`NextResponse`, `headers`, etc.) | yes | **selected** | Framework primitives — not eligible for reuse search. |
| `swr` | yes | **selected** | Already a workspace dep; used by `useWizardState`. |
| `jose` | yes | **selected** | Standard CF Access JWT verifier per Cloudflare's official docs. No CAIA wrapper exists. |

## 5. Surface contract

```ts
// apps/dashboard/middleware.ts
export const config = { runtime: 'nodejs', matcher: ['/((?!_next/static|...).*)'] };
export async function middleware(req: NextRequest): Promise<NextResponse>;

// apps/dashboard/lib/tenants/provision.ts
export async function provisionTenant(
  email: string,
  displayName: string,
  deps: ProvisionDeps,
): Promise<{ tenant: TenantRow; created: boolean }>;

// apps/dashboard/lib/wizard/state.ts
export function useWizardState(projectId: string): UseWizardStateResult;
export interface WizardStateSnapshot {
  projectId: string;
  state: ProjectState;
  currentStepIndex: number | null;
  updatedAtIso: string;
}

// apps/dashboard/lib/wizard/state.server.ts
export async function getWizardState(
  projectId: string,
  deps: { store: StateStore },
): Promise<WizardStateSnapshot>;
```

## 6. Risks + mitigations

| Risk | Mitigation |
|---|---|
| Edge-runtime middleware can't reach `pg`/`nats`. | V1 uses `nodejs` runtime. §2.2 deferred lists the edge split. |
| Two concurrent first-sign-ins create two Infisical workspaces, one tenant row. | `@caia/devops-runtime` daily reconciliation janitor sweeps orphans. Tracked. |
| `@caia/state-machine` PgStateStore constructor shape may drift. | Structural cast in `lib/wizard/store-wire.ts` — typed only for the bits we use. Pinned via workspace:*. |
| Tests use mocked `pg.Pool` and mocked `fetch`. | Trade-off is explicit. Integration tests against a real Postgres + real Infisical land in Wave 2 (per `@caia/secrets-infisical`'s existing pattern). |
| Inline `style={...}` in layout wrappers may drift from `@caia/ui` look. | Acknowledged WARNING-only Semgrep rule. Wave 2 will extract a `@caia/ui` `Stack` / `Page` primitive to absorb the wrappers. |

## 7. Definition of Done

- [x] Branch cut from `origin/develop`.
- [x] All 10 spec deliverables present.
- [x] ≥30 vitest cases — actual: 60+.
- [x] 1 Playwright E2E spec.
- [x] PLAN.md + EA-REVIEW-OUTCOME.json + scripts/submit-plan.mjs.
- [x] `tenant.provisioned` registered in `registry.yaml`.
- [x] Zero raw shadcn / Radix / axios / better-sqlite3 imports outside their wrapper packages.
- [ ] CI green on develop after PR open. (Operator gate — not asserted by the planner.)
- [ ] PR merged to develop with `[True-Zero admin-merge]` subject. (Operator gate — only proceeds after the planner stops for human review of the auth code.)

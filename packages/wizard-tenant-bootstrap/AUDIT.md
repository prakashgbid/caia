# AUDIT — Per-Tenant Migration Runner (Phase A3 of wizard E2E gap analysis)

**Audit date:** 2026-05-26
**Auditor:** prakash (via Claude session)
**Scope:** "Do per-tenant Postgres schema migrations actually RUN when a new tenant is provisioned?"
**Verdict:** ❌ **NO** — and the audit reveals three architectural conflicts that must be resolved before an orchestrator can be built honestly.

---

## 1. Inventory of migration files

Every package under `packages/` plus `apps/dashboard/` was grepped for `migrations/*.sql`. Results:

| Package | File | Uses `{{SCHEMA}}` placeholder? | Target schema | Notes |
|---|---|---|---|---|
| `@caia/state-machine` | `0001_state_machine.sql` | ❌ **No** | `caia_meta` (global) | `tenant_projects`, `state_history`, `ticket_claims` — cross-tenant control plane |
| `@caia/state-machine` | `0002_solution_lifecycle.sql` | ❌ **No** | `caia_meta` (global) | `solution_lifecycle`, `solution_history` |
| `@caia/state-machine` | `0003_information_architect_states.sql` | ❌ **No** | `caia_meta` (global) | Re-asserts `tenant_projects.status` CHECK constraint |
| `@caia/onboarding` | `0001_caia_meta_init.sql` | ❌ **No** | `caia_meta` (global) | `tenants`, `onboarding_steps`, `onboarding_drafts`, `customer_choices`, `credentials`, `audit_log` |
| `@caia/grand-idea` | `001_grand_ideas.sql` | ✅ **Yes** | `{{SCHEMA}}` (per-tenant) | `grand_ideas` table + LISTEN/NOTIFY trigger |
| `@caia/info-architect` | `0001_info_architect.sql` | ✅ **Yes** | `{{SCHEMA}}` (per-tenant) | `pages_catalogue`, `design_systems`, `components_library` |
| `@caia/business-proposal-generator` | `0001_business_proposals.sql` | ✅ **Yes** | `{{SCHEMA}}` (per-tenant) | `business_proposals`, `designapp_prompts`, `proposal_revisions` |
| `@caia/interviewer` | `0001_interviewer.sql` | ✅ **Yes** | `{{SCHEMA}}` (per-tenant) | `interviews`, `interview_turns`, `business_plan_revisions`, `interview_deferred` |
| `@caia/design-ingest` | `0001_ux_uploads.sql` | ❌ **No** | (current connection schema) | `ux_uploads` — uses `tenant_id UUID` row-level scoping, not schema isolation |
| `apps/dashboard` | `0010_wizard_state.sql` | ✅ **Yes** (quoted: `"{{SCHEMA}}"`) | `{{SCHEMA}}` (per-tenant) | `wizard_state` table |
| `apps/dashboard` | `0011_tenants_global.sql` | ❌ **No** | (global) | `tenants` lookup table + `tenant_provision_attempts` audit |

**Substitution syntax** (verified from `packages/grand-idea/src/persistence.ts`, `packages/info-architect/src/persistence.ts`, `packages/interviewer/src/persistence.ts`):

```ts
const sql = template.replace(/\{\{SCHEMA\}\}/g, this.quotedSchema);
```

The substitution is **literal text replacement** of `{{SCHEMA}}` with a `pg`-quoted identifier (`"schema_name"`). `apps/dashboard/migrations/0010_wizard_state.sql` already wraps the placeholder in double-quotes (`"{{SCHEMA}}"`), so the substituted value should NOT be re-quoted for that file — a small but real inconsistency between the dashboard migration and the package migrations.

---

## 2. How migrations CURRENTLY get applied (the gap)

Every per-tenant package implements its own private `ensureSchema()` on its persistence class. The shape, copy-pasted across `grand-idea`, `info-architect`, and `interviewer`:

```ts
public async ensureSchema(): Promise<void> {
  if (this.schemaEnsured) return;
  const template = await readFile(this.migrationPath, 'utf8');
  const sql = template.replace(/\{\{SCHEMA\}\}/g, this.quotedSchema);
  await this.pool.query(sql);
  this.schemaEnsured = true;
}
```

Key properties of the current pattern:

- **Lazy.** Migrations run on first DB access from each package's persistence layer, not at tenant provisioning time.
- **Per-process.** The `schemaEnsured` boolean is in-memory only. Every fresh Node process re-applies on first use. Multi-process deployments (Next.js edge + worker pool + cron jobs) each re-apply independently — fine because the SQL is itself idempotent.
- **No applied-state ledger.** There is no `_migrations_applied` table or equivalent. Migrations are re-applied whenever the in-memory flag is reset (= every new process). The idempotency contract comes from the SQL (`CREATE TABLE IF NOT EXISTS`, `DROP TRIGGER IF EXISTS … CREATE TRIGGER`).
- **No shared runner.** There is no `@caia/migration-runner` or `applyMigrations()` utility. Each package duplicates the read-substitute-execute logic.
- **`business-proposal-generator/src/storage/postgres.ts`** has two `ensureSchema` methods: a real one on the Postgres impl and an empty `{}` stub on (presumably) the in-memory impl.

**`apps/dashboard/lib/tenants/provision.ts` does NOT call any package's `ensureSchema`** after creating the per-tenant schema. It does only:

1. `findByEmail` fast-path
2. `CREATE SCHEMA IF NOT EXISTS "tenant_…"` (raw SQL — empty schema, no tables)
3. Create Infisical workspace
4. `INSERT … ON CONFLICT DO NOTHING` into the global `tenants` row
5. Publish `tenant.provisioned` to NATS

**This means a freshly provisioned tenant's schema is empty.** The wizard's first DB read against `wizard_state`, `grand_ideas`, `pages_catalogue`, etc. will fail with `relation … does not exist` UNLESS the request happens to traverse the persistence layer of a package that runs its own `ensureSchema()` first — which is fragile, ordering-dependent, and silently breaks any read-only access (e.g. SSR rendering an empty wizard).

This is exactly the gap Phase A3 calls out.

---

## 3. Existing tenant-bootstrap facade?

```bash
$ ls packages/wizard-tenant-bootstrap packages/tenant-bootstrap 2>&1
ls: packages/wizard-tenant-bootstrap: No such file or directory
ls: packages/tenant-bootstrap: No such file or directory
```

No existing facade. A new package is justified. **Reuse-first compliance:** the new package will NOT reimplement the per-package `ensureSchema()` logic — it will import and call each package's existing persistence layer (or for packages whose persistence isn't yet wired, it will reuse the same read-template + substitute + execute pattern with a SHARED implementation that the packages can then converge on in a follow-up).

---

## 4. THREE BLOCKERS that must be resolved before the orchestrator is built

### Blocker 1 — Schema-name mismatch between provisioning and packages (CRITICAL)

`apps/dashboard/lib/tenants/store.ts::schemaNameForEmail()` produces names like:

```
tenant_<safe-local-part>_<8-char-fnv-hash>
```

e.g. `prakash@stolution.com` → `tenant_prakash_stolution_com_abc12345`.

Per-tenant packages (`grand-idea`, `info-architect`, `interviewer`) compute schema names independently via their own `tenantSchemaName(slug)`:

```
caia_<short>
```

e.g. slug `prakash-tiwari` → `caia_prakash_tiwari`.

**These are two incompatible naming conventions.** If we call each package's `ensureSchema()` after provisioning, it will create a SECOND schema (`caia_<slug>`) and the wizard's data will fragment across two schemas per tenant. The interviewer's regex `SCHEMA_NAME_RE = /^caia_[a-z0-9_]{1,40}$/` will also reject a `tenant_…` schema name.

**Resolution options (decide before implementation):**

- **(a)** Unify on `tenant_<id>` everywhere. Change `tenantSchemaName(slug)` in the three packages to use the same fn as `schemaNameForEmail()`, and widen `SCHEMA_NAME_RE`. — *Touches grand-idea, info-architect, interviewer; small fan-out.*
- **(b)** Unify on `caia_<slug>` everywhere. Change `schemaNameForEmail()` to drop the FNV suffix and use a slug from email. — *Risks collisions; touches the provisioning layer.*
- **(c)** Pass the schema name through explicitly from `provisionTenant()` into each package's `ensureSchema(schemaName)` instead of having packages compute it. This is the lowest-conflict path: the bootstrap orchestrator owns the schema name and hands it to every package as a parameter. — *Recommended.* Most packages already accept `tenantSchema` in their persistence options; we just call them with the schema name owned by provisioning.

### Blocker 2 — Three packages do NOT use `{{SCHEMA}}` and must not be re-applied per tenant

`@caia/state-machine` (all 3 files), `@caia/onboarding` (0001), and `@caia/design-ingest` (0001) target the global `caia_meta` schema or the current-connection schema — they are **global migrations**, not per-tenant.

The orchestrator must:

- Treat global migrations as a separate concern. They run ONCE per DB cluster (probably on first dashboard boot or via a CI/CD step).
- Run only the per-tenant `{{SCHEMA}}` migrations inside the bootstrap path.

**Per-tenant set (confirmed):**
- `apps/dashboard/migrations/0010_wizard_state.sql`
- `packages/grand-idea/migrations/001_grand_ideas.sql`
- `packages/info-architect/migrations/0001_info_architect.sql`
- `packages/business-proposal-generator/migrations/0001_business_proposals.sql`
- `packages/interviewer/migrations/0001_interviewer.sql`

**Global set (out of scope for bootstrap):**
- `packages/state-machine/migrations/000{1,2,3}_*.sql`
- `packages/onboarding/migrations/0001_caia_meta_init.sql`
- `packages/design-ingest/migrations/0001_ux_uploads.sql`
- `apps/dashboard/migrations/0011_tenants_global.sql`

**Open question:** `design-ingest`'s `ux_uploads` table is currently *neither* per-tenant by schema *nor* per-tenant by row in spirit — it uses `tenant_id UUID` as the row-level discriminator. Is that the desired final design? If yes, it stays global. If no, it needs `{{SCHEMA}}`-ifying before the orchestrator can include it. **This is a product decision.** The audit does not assume an answer.

### Blocker 3 — Live DB verification path is broken

The user prompt requires "Live verification on the stolution Postgres (don't fabricate)". Two reachability checks performed:

- `mcp__stolution-remote__stolution_bash` runs — but `which psql` returned exit 1 and `env | grep DB_` returned empty. The remote shell has no PG client and no DB env vars exposed at the user's shell level.
- `mcp__stolution-remote__stolution_db_query` failed with **`SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`** — the DB credentials are mis-configured (the password env var on the remote is unset or not a string).

**The live integration test for "fresh tenant → tables exist" cannot run end-to-end until the stolution-remote MCP's DB env is fixed.** This is an operator-side fix.

### Bonus blocker — Dirty working tree on the current branch

Current branch is `feature/k3s-istio-cloudflare-tunnel-chiefaia-2026-05-25` with six STAGED uncommitted files (wizard step 1-2 routes/components) and four UNTRACKED dirs (`.caia/scratch/`, `apps/dashboard/app/wizard/atlas/`, `apps/dashboard/app/wizard/design/`, `apps/dashboard/components/wizard/AtlasWizardClient.tsx`).

Cutting `feature/wizard-tenant-migration-runner-2026-05-25` from `origin/develop` requires either committing-or-stashing those changes first. I'm not willing to do that unilaterally — they look like in-progress wizard step work that belongs on its own branch + PR, and a stash isn't the right resting place if the human intends to commit those today.

---

## 5. Proposed orchestrator design (subject to Blocker 1 + 2 resolution)

Assuming we pick **Blocker 1 → option (c)** and **Blocker 2 → keep design-ingest as global for Phase A3**:

### Package: `@caia/wizard-tenant-bootstrap`

```
packages/wizard-tenant-bootstrap/
├── AUDIT.md                  ← this file (lifted in once the branch exists)
├── package.json              ← workspace deps: pg, @chiefaia/event-bus-nats,
│                                @caia/grand-idea, @caia/info-architect,
│                                @caia/interviewer, @caia/business-proposal-generator,
│                                vitest (dev)
├── src/
│   ├── index.ts              ← export { bootstrapTenant, TenantBootstrapResult }
│   ├── runner.ts             ← applyMigration(pool, schemaName, sqlPath)
│   ├── tracker.ts            ← _migrations_applied table CRUD
│   ├── orchestrator.ts       ← bootstrapTenant(...) — fans out across packages
│   └── manifest.ts           ← the ordered list of (packageName, sqlPath)
└── test/
    ├── audit.test.ts         ← assert each manifest entry has {{SCHEMA}}
    ├── runner.test.ts        ← substitution + idempotency unit tests
    ├── tracker.test.ts       ← _migrations_applied semantics
    ├── orchestrator.test.ts  ← happy path + per-package failure
    ├── rollback.test.ts      ← provision rollback drops schema + Infisical
    └── integration.test.ts   ← real Postgres via testcontainers (NEW dep)
```

### `_migrations_applied` shape

```sql
CREATE TABLE IF NOT EXISTS "{{SCHEMA}}"._migrations_applied (
  filename     TEXT        PRIMARY KEY,
  applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  checksum     TEXT        NOT NULL
);
```

Created by the runner itself before the first migration runs in a given schema. Checksum is SHA-256 of the post-substitution SQL — if the file content changes, the runner will re-apply (after logging a warning) because the underlying SQL is already idempotent.

### `TenantBootstrapResult`

```ts
export interface TenantBootstrapResult {
  schemaName: string;
  applied: Array<{ package: string; file: string; durationMs: number }>;
  skipped: Array<{ package: string; file: string; reason: 'already-applied' }>;
  tablesCreated: string[];               // information_schema.tables WHERE table_schema = X
  failures: Array<{ package: string; file: string; error: string }>;
  emittedEventId: string | null;         // tenant.migrations.complete NATS event id
}
```

### Integration with `provision.ts`

After step 2 (`ensureTenantSchema`) and step 3 (Infisical), call `bootstrapTenant({ pool, schemaName, publisher })`. If the result has any failures:

```ts
// Compensating rollback
await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
await deleteInfisicalProject(project.projectId, deps.infisical);
await pool.query(`DELETE FROM tenants WHERE email = $1`, [normEmail]); // only if step 4 already ran
throw new TenantProvisionError('migrations_failed', failures);
```

Idempotency: the `_migrations_applied` ledger short-circuits re-runs, so `bootstrapTenant` called twice is safe (second call's `applied` array is empty, `skipped` lists everything).

### testcontainers vs CI-only Postgres

`grep -h "testcontainers" packages/*/package.json apps/*/package.json` returns nothing — testcontainers is **not currently a workspace dependency**. The CI uses … unknown; needs verification. **I will not add a new dev dep without confirmation.** Options:

- **(a)** Add `@testcontainers/postgresql` (~2 MB) as a dev dep only in `packages/wizard-tenant-bootstrap`.
- **(b)** Use the existing CI Postgres service if `.github/workflows/*.yml` already spins one up — needs verification.
- **(c)** Use `pg-mem` if it's already a transitive dev dep — needs verification.

This is a small but real decision that the audit does not pre-empt.

---

## 6. Honest status — what I can and cannot do unattended

| Step | Can I do it? | Notes |
|---|---|---|
| Write `AUDIT.md` | ✅ Done (this file, in session outputs) | Will be copied to `caia/packages/wizard-tenant-bootstrap/AUDIT.md` once the branch exists |
| Implement `@caia/wizard-tenant-bootstrap` package | ✅ Yes | Pending decisions on Blocker 1 + 2 |
| Add tests (vitest, ≥20) | ✅ Yes | Pending decision on testcontainers vs alternative |
| Wire into `provision.ts` with rollback | ✅ Yes | Pending decision on Blocker 1 |
| Cut feature branch from `origin/develop` | ⚠️ Blocked | Dirty working tree on current branch — needs human to commit/stash the wizard step 1-2 work first |
| Run unit tests locally | ✅ Yes | `pnpm --filter @caia/wizard-tenant-bootstrap test` |
| Run integration test against stolution Postgres | ❌ **Blocked** | DB env not configured on `stolution-remote` MCP — SCRAM error |
| Run integration test against a local Postgres | ⚠️ Partially | Depends on the testcontainers decision above |
| `gh pr create` | ✅ Yes | gh CLI is authenticated as `prakashgbid` |
| Wait for CI green | ⚠️ Depends | GitHub Actions wall-clock time + flakiness — not a guarantee inside one session |
| `gh pr merge --admin` (True-Zero admin-merge) | ✅ Mechanically yes | But this is a destructive action on a real repo; I want explicit confirmation before doing this even with the ratified admin-merge policy |
| Verify by signing in as a fresh email via Cloudflare Access | ❌ **Not by me** | Requires a human in a browser. I can do everything up to "schema is populated" via DB inspection; the Cloudflare Access sign-in path is the human's. |

---

## 7. Recommended next move

1. **Human resolves Blocker 1** — pick (a), (b), or (c). My strong recommendation is (c): the orchestrator passes `schemaName` explicitly into each package's `ensureSchema(schemaName)` and the per-package `tenantSchemaName` helpers become deprecated.
2. **Human resolves Blocker 2** — confirm `@caia/design-ingest` stays global for Phase A3 (it can be `{{SCHEMA}}`-ified in a follow-up).
3. **Human (or operator) fixes the stolution-remote DB env** so live verification can actually run.
4. **Human commits/stashes the current branch's staged work** so I can cut a clean feature branch.
5. Then I will: cut the branch, write the package, write 20+ tests, run them locally, push, open the PR, and report the PR URL. Self-merge will happen only after explicit go-ahead, even though admin-merge is ratified.

This is a four-decision audit gate. None of the four decisions belong to me. The remaining work is mechanical once they're settled.

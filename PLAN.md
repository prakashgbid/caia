# C3 — Per-tenant Claude usage meter wired into `@chiefaia/claude-spawner` (Phase C3)

## Goal

Wire `@caia/billing` (PR #607) into `@chiefaia/claude-spawner` so per-tenant
Claude usage is metered + invoiced via Stripe. Stripe API keys are not yet in
Infisical, so this PR ships in **stub mode**: real plumbing + structure,
gracefully degrades to a no-op meter when `STRIPE_SECRET_KEY` is absent. When
the operator drops the key into Infisical at `caia_global.billing.stripe_secret_key`,
the wiring activates automatically on the next monthly cron tick.

## Reuse-first

- `@caia/billing` (PR #607) — extended; **not** forked.
- `@chiefaia/claude-spawner` — extended with a duck-typed `UsageMeterHook`
  callback; **no** dep cycle into billing.
- `@caia/secrets-adapter` — used via `.list()` for BYOK detection.
- `@chiefaia/tracing` — used for warning logs + the `withClaudeSpawnerSpan`
  wrapper the wizard routes already use.
- `pg` is a runtime dep of the dashboard (already declared); no new package.

reuseSearchResults:
  - @caia/billing
  - @chiefaia/claude-spawner
  - @caia/secrets-adapter
  - @chiefaia/tracing

## Deliverables

1. `@caia/billing`: `src/usage-meter.ts`, `src/claude-spawner-meter-hook.ts`,
   `migrations/0003_tenant_usage_meter.sql`, public re-exports.
2. `@chiefaia/claude-spawner`: `UsageMeterContext` + `UsageMeterHook` plumbed
   through `SpawnClaudeInput`; post-spawn hook invocation inside the OTel span.
3. `apps/dashboard/scripts/aggregate-usage.ts`: monthly cron.
4. `apps/wizard/lib/wizard/claude-meter.ts`: drop-in helper for wizard routes,
   plus `tier-resolver.ts` lookup helper. `interview/answer` route wired as
   the canonical example.
5. Tests: 30 new vitest cases in `tests/usage-meter.test.ts` (+ 5 spawner
   hook tests) covering real-key path, stub-mode path, BYOK skip,
   aggregation correctness, monthly idempotency.
6. README operator runbook excerpt documenting stub-vs-live boundary and
   Stripe key activation flow.

## DoD

- Spawner integration ships.
- Tests pass in both real-key (auto-skipped without env var) and stub-mode paths.
- Migration adds the per-tenant table.
- Cron script exists + README documents operator-side setup.
- True-Zero admin-merge after CI green (tolerate pre-existing TS2352 + lighthouse fails).

# CAIA Kernel Wave 1 — Acceptance Sweep (STOL-1035)

Verification instrument owned by the Kernel Integration Coordinator.
Last sweep: 2026-08-16 ~02:15 EDT (coordinator, live checks on s903). Epic closes only when all items are EVIDENCED (per [[dod-hard-rule]]).

## Per-component

| # | Story | Component | Check | Status | Evidence (verified live) |
|---|-------|-----------|-------|--------|--------------------------|
| 1 | STOL-1050 | CP-01 Temporal | server live, ns `caia`, workflow completes | **PARTIAL** | `stolution-temporal` healthy + `caia-temporal-ui`; ns `caia` exists (id 0896bd1a); workflow `caia-kernel-smoke-d30a2254` (GreetingWorkflow) COMPLETED. Gap: `FactoryRunWorkflow` per §2 not registered. |
| 2 | STOL-1051 | CP-03 Kafka | CAIA topics live; envelope helpers | **PARTIAL** | 7 topics live on stolution-kafka (KID-019 list). `packages/caia-events` + `packages/contracts` (KID-017 mapping) present. Gap: CloudEvents helpers not yet exercised end-to-end. |
| 3 | STOL-1052 | CP-04 OPA | decision endpoint live, allow+deny | **DONE** | `caia-opa` healthy (after coordinator fixes: rego future.keywords + healthcheck env). Verified allow `{"allow":true}` and deny `cost cap exceeded: 2.00 > 1.00 USD`. |
| 4 | STOL-1053 | CP-05 MinIO | buckets versioned; provenance table | **PARTIAL** | Buckets `caia-artifacts/-evidence/-context/-cache/-traces` created, versioning ON (KID-020). Gap: `caia.artifact_provenance` table not verified in PG. |
| 5 | STOL-1054 | CP-09 LiteLLM | gateway live, free-only | **NOT LANDED** | No caia-litellm container. Blocker: no OpenRouter key readable at Vault `secret/stolution/prod/openrouter` (permission denied with local token; secret may not exist — see [[atlassian-token-provisioning-gap]]-style gap). |
| 6 | STOL-1055 | CP-11 Python SDK | caia-factory-sdk v0.1, run_local green | **NOT LANDED** | Only `packages/factory-sdk-ts` stub (sanctioned secondary, KID-018). Python SDK per §6 missing — critical path (KID-002). |
| 7 | STOL-1056 | CP-15 Audit/Cosign | audit stream + signer | **NOT LANDED** | No cosign signer container; job=caia-audit not verified in Loki. |
| 8 | STOL-1057 | CP-14 OTEL | spans/metrics/dashboard | **PARTIAL** | `caia-prom-sd` ran (exit 0), prometheus scrape config in `infra/prometheus/` + context-compiler `/metrics`. Gap: caia.run traces + Grafana CAIA folder unverified. |

## End-to-end status

- Temporal smoke workflow completed in ns `caia` (closest current hello-world; ran via `apps/caia-kernel/temporal-example`).
- Thin-slice run API live (`stolution-caia-slice` serving `/api/runs/{id}`), wizard UI healthy.
- **SF-HELLO per CONTRACTS §11 CANNOT run yet** — requires STOL-1055 (SDK) + STOL-1054 (LiteLLM).

## Wave-1 verdict (coordinator)

**NOT signed off.** 1×DONE, 4×PARTIAL, 3×NOT LANDED. Remaining critical path: STOL-1055 → STOL-1054 → SF-HELLO sweep rerun.

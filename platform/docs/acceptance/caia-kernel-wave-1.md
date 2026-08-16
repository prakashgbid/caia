# CAIA Kernel Wave 1 — Acceptance Sweep (STOL-1035)

Verification instrument owned by the Kernel Integration Coordinator. Evidence is appended per item; Epic closes only when all items are EVIDENCED (per [[dod-hard-rule]]).

## Per-component (merged + deployed + live + wired)

| # | Story | Component | Check | Status | Evidence |
|---|-------|-----------|-------|--------|----------|
| 1 | STOL-1050 | CP-01 Temporal | `caia-temporal:7233` reachable, ns `caia`, FactoryRunWorkflow registered | PENDING | |
| 2 | STOL-1051 | CP-03 Kafka | 3 topics exist; envelope helpers in SDK | PENDING | |
| 3 | STOL-1052 | CP-04 OPA | /v1/data/caia/decision returns per §4.2; caia.base live | PENDING | |
| 4 | STOL-1053 | CP-05 MinIO | bucket caia-artifacts versioned; caia.artifact_provenance applied | PENDING | |
| 5 | STOL-1054 | CP-09 LiteLLM | aliases live, free-only, spend logs in PG | PENDING | |
| 6 | STOL-1055 | CP-11 SDK | caia-factory-sdk v0.1 importable; run_local green in CI | PENDING | |
| 7 | STOL-1056 | CP-15 Audit | job=caia-audit in Loki; cosign signer consuming | PENDING | |
| 8 | STOL-1057 | CP-14 OTEL | caia.run traces + 4 Prometheus metrics + Grafana CAIA folder | PENDING | |

## SF-HELLO end-to-end (CONTRACTS.md §11)

| Step | Check | Status | Evidence |
|------|-------|--------|----------|
| 1 | Temporal workflow run-{run_id} completed | PENDING | |
| 2 | started/completed + greeted events on caia.factory.events.v1 | PENDING | |
| 3 | artifact + provenance row (sha256) | PENDING | |
| 4 | LiteLLM spend row, free model | PENDING | |
| 5 | OPA allow decisions logged | PENDING | |
| 6 | caia.run trace with mandatory attrs | PENDING | |
| 7 | audit lines in Loki | PENDING | |

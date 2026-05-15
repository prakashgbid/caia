# SPS — Smart Parallelism Scheduler (Phase 2)

Canonical source for the SPS service. Python 3.11 / FastAPI; runs in the K3s
`caia-orchestrator` namespace as a single-replica Deployment.

## Layout

| File | Role |
|------|------|
| `main.py` | FastAPI app — DAG scheduler, retries, dead-letter, stuck-audit, /metrics |
| `smoke.sh` | 44-test phase-2 end-to-end smoke against a running pod |
| `sps-deploy-phase2.yaml` | K3s Deployment + Service manifest |
| `cronjob-stuck-audit.yaml` | K3s CronJob — runs `/admin/audit/stuck-tasks` every 5 min |
| `cronjob-daily-backup.yaml` | K3s CronJob — sqlite snapshot at 04:00 UTC |

The SQLite schema (`00_baseline_schema.sql`) is **NOT** in this directory — it
lives at `caia/infra/stolution/sps/schema/` as paired infra alongside the
migration framework + audit cron + tests. SPS mounts both via the `sps-src`
ConfigMap on the running pod (`SPS_SCHEMA_PATH=/app/schema.sql`).

## Source-history continuity

Before 2026-05-15 the Phase 2 source lived outside the caia monorepo at:

    ~/Documents/projects/reports-from-m1/smart-parallelism-scheduler-artifacts/phase2/

That directory remains intact for historical reference; this directory is the
live source from B1 migration (PR `feat/b1-sps-migrate-to-caia-services-2026-05-15`)
onward. The migration was source-relocate only — no code edits, no re-architecture.
See `reports/integration_b1_sps_migrate_2026-05-15.md` for the migration report.

## Local smoke

The CI workflow `.github/workflows/services-sps.yml` runs smoke.sh against a
local uvicorn boot on every PR touching this directory. To reproduce locally:

    pip install fastapi 'uvicorn[standard]' pydantic httpx
    export SPS_DB_PATH=/tmp/sps.db
    export SPS_SCHEMA_PATH=$(git rev-parse --show-toplevel)/infra/stolution/sps/schema/00_baseline_schema.sql
    export SPS_PHASE=2
    export SPS_MEMORY_ROOT=/tmp/agent-memory
    mkdir -p /tmp/agent-memory
    uvicorn main:app --host 127.0.0.1 --port 8080 &
    BASE=http://127.0.0.1:8080 bash smoke.sh

Expected: 44 PASS / 0 FAIL (smoke.sh test 12 — slot-manager sibling sanity —
is skipped when no kubectl context is present).

## Operator: post-merge K3s ConfigMap redeploy

The K3s deployment mounts `main.py` and `schema.sql` via the ConfigMap `sps-src`
in the `caia-orchestrator` namespace. The ConfigMap is **not** auto-synced from
this directory — after any change merges to `develop`, the operator must
recreate it and restart the pod:

    cd ~/Documents/projects/caia
    kubectl -n caia-orchestrator create configmap sps-src \
      --from-file=main.py=services/sps/main.py \
      --from-file=schema.sql=infra/stolution/sps/schema/00_baseline_schema.sql \
      --dry-run=client -o yaml | kubectl apply -f -
    kubectl -n caia-orchestrator rollout restart deployment/sps
    kubectl -n caia-orchestrator rollout status deployment/sps --timeout=120s

Then re-run smoke.sh against the live ClusterIP (omit `BASE`; smoke.sh
auto-resolves via `kubectl get svc`).

This manual step is the bridge until Phase B5 / Guardrail 7 lands a digest-pinned
image build that the post-merge deploy gate redeploys automatically.

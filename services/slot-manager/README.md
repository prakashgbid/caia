# slot-manager — Self-Driving Slot Allocator (Phase 4)

Canonical source for the slot-manager service. Python 3.11 / FastAPI; deployed in the K3s
`caia-orchestrator` namespace. The autonomous loop polls SPS for ready work, claims slots
up to per-bucket capacity, dispatches the spec to a registered claude-spawner-agent host,
and releases the slot when the spawn returns — all without operator triggers.

## Layout

| File              | Role                                                                                                  |
|-------------------|-------------------------------------------------------------------------------------------------------|
| `slot_manager.py` | FastAPI app — autonomous loop, /spawn-task, admin endpoints, lineage, retry/dead-letter, circuit-break |
| `schema.sql`      | SQLite WAL schema (Phases 0/1/2/4/5; idempotent hot-rollout)                                          |
| `requirements.txt`| Python dependencies (pinned to minor)                                                                 |
| `smoke.sh`        | Smoke test: syntax-check + schema-apply (in-memory SQLite) + import-test                              |
| `package.json`    | `pnpm -F @caia/services-slot-manager run smoke` wrapper                                               |

## Runtime contract

- SQLite WAL DB at `${SLOT_MANAGER_DB_PATH}` (default `/app/data/slot-manager.db`).
- Schema applied from `${SCHEMA_PATH}` (default `/app/src/schema.sql`).
- Per-bucket autonomy defaults to **OFF** (operator opts in via `/admin/autonomy`).
- Global autonomy defaults to **ON**.
- Subscription guard non-negotiable (zero-dollar rule, `feedback_no_api_key_billing.md`).
  All four layers (slot-manager startup + per-call, spawner startup + per-call) are
  active; `ANTHROPIC_API_KEY` is treated as a red flag.

## Source-history continuity

Before 2026-05-15 the Phase 4/5 source lived outside the caia monorepo at:

    ~/Documents/projects/reports-from-m1/slot-manager-artifacts/phase5/

That directory remains intact on M3 for historical reference; this directory is the live
source from B2 migration (PR `feat/b2-slot-manager-spawner-migrate-2026-05-15`) onward.
The migration was source-relocate only — no code edits, no re-architecture. See
`reports/integration_b2_slot_manager_migrate_2026-05-15.md` for the migration report.

## Sibling service

`services/claude-spawner-agent/` is the M1-side daemon that this slot-manager dispatches
to. The two co-evolved (slot-manager defines the wire contract; claude-spawner-agent is
the host-side executor). They are migrated together in B2.

## K3s

K3s ConfigMap continues to mount the canonical schema + source from this directory
(`slot-manager-src` ConfigMap). The deploy manifest will land in a follow-up B-chain phase
(per integration-remediation plan §B Phase B3 / B4). Until then, the existing manifest
sources from the prior path and operator must update the ConfigMap reference in step
with the merge of this PR.

## CI

A path-filtered smoke workflow at `.github/workflows/services-smoke.yml` runs on every PR
that touches `services/slot-manager/**`. The workflow invokes `bash smoke.sh` in this
directory.

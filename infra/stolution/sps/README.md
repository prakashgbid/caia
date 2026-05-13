# SPS (Smart Parallelism Scheduler) — schema & migrations

Canonical home in this repo for SPS SQLite schema, migrations, and acceptance
tests. SPS itself is a Python FastAPI service deployed to the stolution k3s
cluster at `/data/sps.db` (host path `/home/s903/apps/sps/data/sps.db`); the
source artefacts live in `reports-from-m1/smart-parallelism-scheduler-artifacts/`.
This directory only holds the schema-as-code surface that needs to live in
version control alongside CAIA.

## Layout

```
schema/00_baseline_schema.sql         — canonical schema (mirror of the SPS service)
migrations/<datestamp>_<name>.sql     — sequenced, idempotent migrations
tests/test_*.sh                       — acceptance tests, run against an
                                        ephemeral DB seeded from baseline+migrations
```

## Applying a migration to a live DB

```bash
BAK=~/.sps/sps.db.bak-$(date +%Y-%m-%d)-pre-<migration-tag>
cp ~/.sps/sps.db "$BAK"
sqlite3 ~/.sps/sps.db < migrations/<datestamp>_<name>.sql
```

The migration tracks itself in `schema_migrations(name)`; re-applying the same
migration aborts the transaction (INSERT conflict on the marker row).

## 2026-05-13 — B15.M done-status triggers

`migrations/2026-05-13_b15b_done_triggers.sql` closes Gap 5 door 3 (ad-hoc
`sqlite3` shell writes that bypass the application). It bundles the B15.C
schema additions (nullable evidence columns) because the triggers reference
them; B15.C is otherwise behaviour-neutral until B15.E lands.

See `tests/test_b15b_done_triggers.sh` for the 3 negative + 1 positive
acceptance tests.

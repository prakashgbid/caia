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
scripts/<name>.py                     — operational scripts (e.g. cron jobs)
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

## 2026-05-13 — B15.D verifier verdicts

`migrations/2026-05-13_b15d_verifier_verdicts.sql` adds the `verifier_verdicts`
table (full provenance for every VERIFIER spawn run — see
`packages/verifier/`) and replaces `done_status_guard` with a version that
ALSO checks for a row in that table with `overall='pass'` for every
autonomous-loop (scope-2/3) subtask done-transition. Operator-routed
(scope-1) subtasks remain advisory — the verdict is recorded but does not
block, matching the design's
"blocking-for-autonomous-loop / advisory-for-operator-routed" rule.

See `tests/test_b15d_verifier_verdicts.sh` for the negative + positive
acceptance tests (6/6 pass).

Apply order: `2026-05-13_b15b_done_triggers.sql` first, then
`2026-05-13_b15d_verifier_verdicts.sql`. The B15.D migration drops and
recreates `done_status_guard`; B15.B's `done_status_history_guard` and
`cascade_on_done` are untouched.

## 2026-05-13 — B15.E reliability_rolling + hourly audit cron

`migrations/2026-05-13_b15e_reliability_rolling.sql` adds the
`reliability_rolling` table (one row per 1h audit bucket) and the
`redecompose_queue` table (auto-redo target for nodes scoring ≤ 2).

`scripts/audit_recent_done.py` is the deterministic local scorer that fires
hourly. It reads `done` nodes from the closed hour, applies the 0–5 rubric from
`completion_audit_methodology_2026-05-10.md` to each, UPSERTs a row into
`reliability_rolling`, dispatches score≤2 nodes into `redecompose_queue`
(B14.J path), and appends a `[B15.E reliability-alert]` line to `INBOX.md`
when the bucket reliability drops below 95% (or flips from clear to breached).

Cron registration: `~/Library/LaunchAgents/com.chiefaia.sps-audit-recent-done-hourly.plist`
(launchd, `StartCalendarInterval Minute=0` ≡ cron `0 * * * *`).
Logs at `~/Library/Logs/chiefaia/sps-audit-recent-done.{out,err}.log`.

See `tests/test_b15e_audit_recent_done.sh` for the 6 acceptance tests
(schema / empty-bucket / bucket-math / auto-redo / INBOX-alert / UPSERT
idempotence — 6/6 pass).

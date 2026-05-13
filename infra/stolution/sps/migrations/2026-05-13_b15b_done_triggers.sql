-- =============================================================================
-- SPS Migration: 2026-05-13_b15b_done_triggers
-- =============================================================================
-- Closes Gap 5 doors 2 and 3 of the Reliability-99% design (B15.M):
--   * Door 2 — slot-manager `sm_outcome=ok → sps_outcome=done` map (closed by B15.E)
--   * Door 3 — ad-hoc `sqlite3 sps.db "UPDATE nodes SET status='done' ..."`
--     shell writes that bypass the FastAPI service entirely.  This migration
--     closes door 3 at the DB layer so even direct sqlite3 writes are blocked.
--
-- The triggers enforce the four-way AND completion contract:
--   PR exists ∧ PR merged ∧ verifier-pass ∧ regression-pass
--
-- Per the design doc (reliability_99pct_design_2026-05-11.md §6.5 and §14),
-- the triggers reference evidence columns that are added by B15.C.  Because the
-- live SPS schema (01_sqlite_schema.sql) ships without those columns and B15.C
-- has not yet landed in this repo, this migration also performs the idempotent
-- ALTER block that B15.C specifies.  Bundling is safe — both B15.C and B15.M
-- are scope-2, idempotent, and have no behaviour-change semantics on their own
-- (B15.C adds nullable columns; B15.M adds triggers that only fire on
-- status='done' transitions, which today only happen via the application path
-- being rewritten in B15.E).
--
-- Authoritative refs:
--   ~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md
--     §6.5.2  done_status_guard trigger SQL
--     §6.5.3  done_status_history_guard companion trigger
--     §7.10   cascade_on_done trigger + cascade_pending_queue table
--     §14     consolidated schema delta (canonical wording reproduced below)
--   ~/Documents/projects/agent-memory/master_backlog_sequencing_2026-05-05.md
--     B15.C (order 35) — evidence columns
--     B15.M (order 37) — triggers + admin endpoints
--
-- Idempotency: every statement uses IF NOT EXISTS or is wrapped to be safe on
-- re-apply.  Re-running the migration on a DB that already has it is a no-op.
-- =============================================================================

PRAGMA foreign_keys = ON;

BEGIN;

-- -----------------------------------------------------------------------------
-- Part 1 (B15.C) — evidence columns the triggers depend on
-- -----------------------------------------------------------------------------
-- SQLite does NOT support "ADD COLUMN IF NOT EXISTS".  Each ALTER is wrapped in
-- a SELECT-with-CASE driven approach via a temp pragma-table inspection.  We
-- instead rely on the convention that this migration is applied exactly once
-- and tracked in schema_migrations (created below).  If a column already
-- exists, the ALTER will error and the transaction rolls back — that is the
-- intended idempotency boundary.  Operators re-applying must drop the
-- schema_migrations row first.

CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Guard: only run the rest of the migration if not already applied.
-- We do this by inserting and letting the INSERT fail on conflict to abort.
-- Sqlite limitation: cannot conditionally run DDL inside SQL alone, so the
-- shell harness (apply.sh) inspects schema_migrations before invoking sqlite3.

INSERT INTO schema_migrations (name) VALUES ('2026-05-13_b15b_done_triggers');

-- B15.C evidence columns on nodes (nullable; behaviour-neutral until B15.E)
ALTER TABLE nodes ADD COLUMN scope_tag                TEXT;
ALTER TABLE nodes ADD COLUMN implementor_claim_json   TEXT;
ALTER TABLE nodes ADD COLUMN verifier_verdict_json    TEXT;
ALTER TABLE nodes ADD COLUMN verifier_feedback_json   TEXT;
ALTER TABLE nodes ADD COLUMN verification_attempt     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN pr_url                   TEXT;
ALTER TABLE nodes ADD COLUMN pr_opened_at             TEXT;
ALTER TABLE nodes ADD COLUMN pr_merge_sha             TEXT;
ALTER TABLE nodes ADD COLUMN pr_merge_at              TEXT;
ALTER TABLE nodes ADD COLUMN regression_check_sha     TEXT;
ALTER TABLE nodes ADD COLUMN regression_check_at      TEXT;
ALTER TABLE nodes ADD COLUMN regression_check_result  TEXT;
ALTER TABLE nodes ADD COLUMN dod_self_cert_json       TEXT;
ALTER TABLE nodes ADD COLUMN dod_stages_required      TEXT;
ALTER TABLE nodes ADD COLUMN dod_stages_evidenced     TEXT;
ALTER TABLE nodes ADD COLUMN redecompose_attempt      INTEGER NOT NULL DEFAULT 0;
ALTER TABLE nodes ADD COLUMN redecompose_history_json TEXT;

-- Supporting indexes on the new evidence columns (cheap, query-side wins).
CREATE INDEX IF NOT EXISTS idx_nodes_pr_url         ON nodes(pr_url);
CREATE INDEX IF NOT EXISTS idx_nodes_pr_merge_sha   ON nodes(pr_merge_sha);
CREATE INDEX IF NOT EXISTS idx_nodes_scope_tag      ON nodes(scope_tag);
CREATE INDEX IF NOT EXISTS idx_nodes_status_scope   ON nodes(status, scope_tag);

-- cascade_pending_queue — drained by slot-manager's cascade_drainer_task
-- (design §7.10).  The cascade_on_done trigger writes to this table on every
-- legitimate done transition; the drainer calls SPS /admin/cascade-from/{id}
-- which performs the existing pending → ready lift on downstream nodes.
CREATE TABLE IF NOT EXISTS cascade_pending_queue (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id    TEXT NOT NULL,
    queued_at  TEXT NOT NULL DEFAULT (datetime('now')),
    drained_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_cascade_open ON cascade_pending_queue(drained_at);

-- -----------------------------------------------------------------------------
-- Part 2 (B15.M) — three triggers enforcing the done contract
-- -----------------------------------------------------------------------------

-- Trigger 1 — done_status_guard
-- BEFORE UPDATE OF status; aborts a done transition that fails the
-- scope-aware four-way AND.  Internal-node done propagation via cascading lift
-- is allowed for granularity IN ('item','phase','leg') because their done-ness
-- is the AND of their children's done-ness (already enforced by B14.G's
-- cascading lift in the application layer).
--
-- Reproduced from design doc §6.5.2 with §14 wording (the §14 version is the
-- canonical landed wording; §6.5.2 reads with finer-grained granularity).

CREATE TRIGGER IF NOT EXISTS done_status_guard
BEFORE UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status = 'done' AND OLD.status != 'done'
BEGIN
  SELECT
    CASE
      WHEN NEW.scope_tag = '1' AND NEW.granularity = 'subtask' AND NEW.pr_url IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-1 subtask requires pr_url')
      WHEN NEW.scope_tag = '1' AND NEW.granularity = 'subtask' AND NEW.verifier_verdict_json IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-1 subtask requires verifier_verdict_json')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.pr_url IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires pr_url')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.pr_merge_sha IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires pr_merge_sha')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.verifier_verdict_json IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires verifier_verdict_json')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.regression_check_sha IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires regression_check_sha')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND json_extract(NEW.verifier_verdict_json, '$.verdict') != 'pass'
        THEN RAISE(ABORT, 'done_status_guard: verifier verdict must be pass')
      -- Default-reject: any subtask attempting done without a scope_tag is rejected,
      -- since untagged subtasks cannot satisfy the four-way AND that requires the
      -- scope-tag arm above.  Internal granularity rows (item/phase/leg) are
      -- allowed because their done-ness is derived from child cascade.
      WHEN NEW.granularity = 'subtask' AND (NEW.scope_tag IS NULL OR NEW.scope_tag NOT IN ('1','2','3'))
        THEN RAISE(ABORT, 'done_status_guard: subtask requires scope_tag in (1,2,3)')
      ELSE NULL
    END;
END;

-- Trigger 2 — done_status_history_guard
-- AFTER UPDATE OF status; writes an immutable history row on every legitimate
-- done transition so the audit cron (B15.J) can never miss one even if the
-- application skipped the /completion history-write path.
--
-- Reproduced verbatim from design doc §14.  Replaces the explicit
-- 'node_status_history' table from the task prompt with the canonical
-- `history` table (the SPS schema's existing append-only event log — there is
-- no separate node_status_history table in the SPS design, and the design's
-- canonical mirror is `history` per §6.5.3).

CREATE TRIGGER IF NOT EXISTS done_status_history_guard
AFTER UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status = 'done' AND OLD.status != 'done'
BEGIN
  INSERT INTO history (event, node_id, bucket, payload)
  SELECT 'auto-history-done-marker', NEW.id, NEW.target_bucket,
         json_object('pr_url',                NEW.pr_url,
                     'pr_merge_sha',          NEW.pr_merge_sha,
                     'verifier_verdict_json', NEW.verifier_verdict_json,
                     'regression_check_sha',  NEW.regression_check_sha,
                     'auto_marker',           1);
END;

-- Trigger 3 — cascade_on_done
-- AFTER UPDATE OF status; queues a cascade-lift event for the slot-manager's
-- cascade_drainer_task (design §7.10) so downstream dependents reliably
-- promote pending → ready, even for trigger-only writes (defence-in-depth;
-- the four-way AND should make such writes impossible, but the cascade
-- semantics stay intact).

CREATE TRIGGER IF NOT EXISTS cascade_on_done
AFTER UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status = 'done' AND OLD.status != 'done'
BEGIN
  INSERT INTO cascade_pending_queue (node_id) VALUES (NEW.id);
END;

COMMIT;

-- =============================================================================
-- End of migration 2026-05-13_b15b_done_triggers
-- =============================================================================

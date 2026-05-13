-- =============================================================================
-- SPS Migration: 2026-05-13_b15e_reliability_rolling
-- =============================================================================
-- Adds the rolling reliability ledger that the hourly `audit_recent_done`
-- cron writes to.  Companion to:
--   * B15.B (2026-05-13_b15b_done_triggers.sql)       — static guard
--   * B15.D (2026-05-13_b15d_verifier_verdicts.sql)   — VERIFIER sibling
--   * scripts/audit_recent_done.py                    — the audit job
--   * Library/LaunchAgents/com.chiefaia.sps-audit-recent-done-hourly.plist
--                                                      — the hourly trigger
--
-- Closes the FEEDBACK loop of the Reliability-99% design (B15.E):
--   triggers + verifier provide STATIC defence (block bad writes); the audit
--   cron + this table + INBOX alerts provide DYNAMIC defence (re-score what
--   slipped through and re-decompose the worst items via B14.J).
--
-- Schema design notes:
--   * One row per audit bucket (1h window).  bucket_start is the PRIMARY KEY
--     so the audit script can UPSERT (INSERT ... ON CONFLICT(bucket_start) DO
--     UPDATE) and idempotently re-run the audit for any bucket without
--     duplicating rows.
--   * `reliability_pct` is computed at write-time, not as a generated column,
--     so the audit script controls the divisor (synthetic test::* nodes are
--     excluded per completion-audit methodology §2 sub-rule + §4 Class D).
--   * `breached_threshold` is a snapshot-at-write of `reliability_pct < 95`,
--     stored explicitly so downstream alerting can detect threshold *flips*
--     (transition between consecutive buckets) without re-deriving the rule.
--   * `nodes_redecomposed_json` carries the list of node_ids the audit pushed
--     into B14.J's re-decompose path during the same run, for traceability.
--
-- Authoritative refs:
--   ~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md
--     §6.6   reliability_rolling table + audit_recent_done cron (B15.E)
--     §6.7   INBOX.md alert format on breach
--     §6.8   auto-redo path (B14.J integration)
--   ~/Documents/projects/agent-memory/completion_audit_methodology_2026-05-10.md
--     §2     0–5 scoring rubric (the audit script implements this)
--     §4     per-class verification methods
--     §8     aggregate definitions (reliability rate = score≥3 / real items)
--   ~/Documents/projects/agent-memory/scope_pipeline_unification_2026-05-10.md
--     §[12]  re-decomposition on code/uncompletable (B14.J)
--
-- Idempotency: every statement uses IF NOT EXISTS.  Re-running the migration
-- on a DB that already has it is a no-op (the schema_migrations row is the
-- only side-effect that can collide, and it conflicts harmlessly).
-- =============================================================================

PRAGMA foreign_keys = ON;

BEGIN;

INSERT INTO schema_migrations (name) VALUES ('2026-05-13_b15e_reliability_rolling');

-- -----------------------------------------------------------------------------
-- reliability_rolling — one row per hourly audit bucket
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reliability_rolling (
    -- Bucket window — half-open interval [bucket_start, bucket_end).
    -- bucket_start is normalised to the start of the hour in UTC ISO-8601
    -- (e.g. '2026-05-13T03:00:00Z'); bucket_end = bucket_start + 1h.
    bucket_start              TEXT    PRIMARY KEY,
    bucket_end                TEXT    NOT NULL,

    -- Headline counts (excluding synthetic test::* nodes per Class-D rule).
    nodes_audited             INTEGER NOT NULL DEFAULT 0,
    nodes_passing             INTEGER NOT NULL DEFAULT 0,   -- score >= 3
    nodes_score_le_2          INTEGER NOT NULL DEFAULT 0,   -- score <= 2 (auto-redo target)
    nodes_score_3_to_4        INTEGER NOT NULL DEFAULT 0,
    nodes_score_5             INTEGER NOT NULL DEFAULT 0,

    -- Computed reliability percentage (0.0 - 100.0).  Stored, not generated,
    -- so the audit script controls the divisor (excluded synthetic nodes).
    -- NULL when nodes_audited = 0 (degenerate bucket — no audit signal).
    reliability_pct           REAL,

    -- Snapshot-at-write of `reliability_pct < 95.0`.  Stored explicitly so the
    -- INBOX alert wiring can detect FLIPS between consecutive buckets without
    -- re-deriving the rule (the threshold itself is a constant in the audit
    -- script — moving it requires a code change AND a backfill).
    breached_threshold        INTEGER NOT NULL DEFAULT 0
                                CHECK (breached_threshold IN (0,1)),

    -- Audit-run provenance.  Multiple audit_run_ids per bucket are possible
    -- only when the audit is replayed; the LATEST run wins (UPSERT behaviour).
    audit_run_id              TEXT    NOT NULL,
    audit_started_at          TEXT    NOT NULL,
    audit_finished_at         TEXT    NOT NULL,
    audit_duration_ms         INTEGER,

    -- Auto-redo trace (B14.J integration).  JSON array of {node_id, score,
    -- reason} for every node the audit dispatched into the re-decompose
    -- queue during this run.  Empty array '[]' when none were dispatched.
    nodes_redecomposed_json   TEXT    NOT NULL DEFAULT '[]',

    -- Free-form notes (e.g. "audit aborted at node X — partial bucket").
    notes                     TEXT
);

CREATE INDEX IF NOT EXISTS idx_reliability_rolling_breach
    ON reliability_rolling(breached_threshold, bucket_start);
CREATE INDEX IF NOT EXISTS idx_reliability_rolling_audit_run
    ON reliability_rolling(audit_run_id);

-- -----------------------------------------------------------------------------
-- redecompose_queue — light-weight target table for the B14.J path
-- -----------------------------------------------------------------------------
-- Per the design, B14.J's reconciler polls SPS for rows with
-- `next_action='re-decompose'`.  In the live SPS service that lives in the
-- DLQ table, but this stand-alone Mac-side DB doesn't yet have the DLQ — we
-- create a thin queue table so the audit script can record its dispatch
-- decisions deterministically and the B14.J reconciler can drain them with
-- the same SELECT shape.  When the live DLQ lands here this table can be
-- replaced by a VIEW backed by `dead_letter`.
CREATE TABLE IF NOT EXISTS redecompose_queue (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id         TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    next_action     TEXT    NOT NULL DEFAULT 're-decompose'
                       CHECK (next_action IN ('re-decompose','operator-decision','escalate')),
    -- The score the audit assigned that triggered this dispatch (≤ 2).
    audit_score     INTEGER NOT NULL CHECK (audit_score BETWEEN 0 AND 5),
    audit_reason    TEXT,
    audit_run_id    TEXT    NOT NULL,
    audit_bucket    TEXT    NOT NULL,
    queued_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    -- Bounded by depth, not time — see scope_pipeline_unification §[12].
    depth_at_queue  INTEGER NOT NULL DEFAULT 0,
    decided         INTEGER NOT NULL DEFAULT 0 CHECK (decided IN (0,1)),
    decided_at      TEXT,
    UNIQUE (node_id, audit_run_id)
);

CREATE INDEX IF NOT EXISTS idx_redecompose_queue_open
    ON redecompose_queue(decided, next_action, queued_at);
CREATE INDEX IF NOT EXISTS idx_redecompose_queue_node
    ON redecompose_queue(node_id);

COMMIT;

-- =============================================================================
-- End of migration 2026-05-13_b15e_reliability_rolling
-- =============================================================================

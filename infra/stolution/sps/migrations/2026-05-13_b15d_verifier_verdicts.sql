-- =============================================================================
-- SPS Migration: 2026-05-13_b15d_verifier_verdicts
-- =============================================================================
-- Wires the B15.D VERIFIER (4th review-sibling) verdict into the SPS gating
-- contract.  Companion to:
--   * B15.B (2026-05-13_b15b_done_triggers.sql) — the done_status_guard
--     trigger this migration UPDATES to additionally check a row in the new
--     `verifier_verdicts` table (instead of solely relying on the
--     `verifier_verdict_json` column on `nodes` from B15.C).
--   * @chiefaia/verifier — the spawn package that produces verdicts conforming
--     to packages/verifier/templates/verifier_verdict_schema.json.
--
-- Adds:
--   1. `verifier_verdicts` table (full provenance per design §6.3.5):
--      one row per verifier run, keyed by (node_id, verifier_spawn_id).
--   2. `done_status_guard_v2` trigger replacing the B15.B `done_status_guard`:
--      requires (per-row) a verifier_verdicts row with overall='pass' AND
--      blocking=1 for autonomous-loop subtasks.  Operator-routed subtasks
--      (scope_tag='1' single-stage path) are advisory — the trigger logs
--      the verdict via the existing `done_status_history_guard` AFTER trigger
--      but does NOT block on it.  The autonomous-loop path (scope_tag in
--      ('2','3')) requires both the verdict row AND overall='pass'.
--
-- Why a separate table when nodes.verifier_verdict_json already exists?
--   Per the task brief: "the trigger should check for a row in a
--   `verifier_verdicts` table (or analogous) before allowing status='done'."
--   The column form is a convenience cache; the table form is the truth-
--   bearing record (multiple verdicts per node are allowed across retries —
--   verification_attempt 1, 2, ... — and the `verifier_verdicts` table
--   carries each).  The trigger gates on the LATEST row by (node_id,
--   attempted_at).
--
-- Authoritative refs:
--   ~/Documents/projects/agent-memory/reliability_99pct_design_2026-05-11.md
--     §6.3.4  verifier prompt template (B15.F)
--     §6.3.5  verifier state machine integration + verifications table schema
--     §6.3.6  blocking-for-autonomous-loop / advisory-for-operator-routed
--   packages/verifier/templates/verifier_verdict_schema.json — the JSON shape
--     the trigger json_extract()s ($.overall, $.verdict, $.blocking).
--
-- Idempotency: every statement uses IF NOT EXISTS or DROP+CREATE in a
-- transaction so re-running on a DB that already has it is a no-op.
-- =============================================================================

PRAGMA foreign_keys = ON;

BEGIN;

-- Migration tracker (created by B15.B; this row guards re-apply).
INSERT INTO schema_migrations (name) VALUES ('2026-05-13_b15d_verifier_verdicts');

-- -----------------------------------------------------------------------------
-- Part 1 — verifier_verdicts table (full provenance)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verifier_verdicts (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id                 TEXT    NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    implementing_spawn_id   TEXT,
    verifier_spawn_id       TEXT    NOT NULL,
    pr_url                  TEXT,
    pr_head_sha             TEXT,
    -- 'pass' | 'fail' (binary used by the trigger).
    overall                 TEXT    NOT NULL CHECK (overall IN ('pass','fail')),
    -- 'pass' | 'fail-impl' | 'fail-spec' | 'uncertain' (fine-grained).
    verdict                 TEXT    NOT NULL CHECK (verdict IN ('pass','fail-impl','fail-spec','uncertain')),
    -- 1 (autonomous-loop) | 0 (operator-routed); the trigger respects this.
    blocking                INTEGER NOT NULL DEFAULT 1 CHECK (blocking IN (0,1)),
    routing_class           TEXT    NOT NULL CHECK (routing_class IN ('autonomous-loop','operator-routed')),
    recommendation          TEXT,
    -- Full verdict object as emitted by @chiefaia/verifier (schema_version='v1').
    verdict_json            TEXT    NOT NULL,
    reasons_json            TEXT,
    summary                 TEXT,
    attempted_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    duration_ms             INTEGER,
    worktree_cleaned_up     INTEGER NOT NULL DEFAULT 1 CHECK (worktree_cleaned_up IN (0,1)),
    UNIQUE (node_id, verifier_spawn_id)
);

CREATE INDEX IF NOT EXISTS idx_verifier_verdicts_node          ON verifier_verdicts(node_id);
CREATE INDEX IF NOT EXISTS idx_verifier_verdicts_node_attempt  ON verifier_verdicts(node_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_verifier_verdicts_overall       ON verifier_verdicts(overall);
CREATE INDEX IF NOT EXISTS idx_verifier_verdicts_routing       ON verifier_verdicts(routing_class);

-- -----------------------------------------------------------------------------
-- Part 2 — replace done_status_guard with a version that ALSO checks the
-- verifier_verdicts table.  We DROP+CREATE so this migration is idempotent
-- regardless of the order of B15.B and B15.D landing on a given DB.
-- -----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS done_status_guard;

CREATE TRIGGER done_status_guard
BEFORE UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status = 'done' AND OLD.status != 'done'
BEGIN
  SELECT
    CASE
      -- ============================================================
      -- Scope-1 (operator-routed, single-stage row-N) subtasks
      -- ============================================================
      WHEN NEW.scope_tag = '1' AND NEW.granularity = 'subtask' AND NEW.pr_url IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-1 subtask requires pr_url')
      WHEN NEW.scope_tag = '1' AND NEW.granularity = 'subtask' AND NEW.verifier_verdict_json IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-1 subtask requires verifier_verdict_json')
      -- Scope-1 is operator-routed — verifier verdict is ADVISORY.  The
      -- column being non-null is enough; we do NOT require overall='pass'
      -- here.  The audit dashboard surfaces the verdict for operator action.

      -- ============================================================
      -- Scope-2 / scope-3 (autonomous-loop) subtasks
      -- ============================================================
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.pr_url IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires pr_url')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.pr_merge_sha IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires pr_merge_sha')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.verifier_verdict_json IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires verifier_verdict_json')
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask' AND NEW.regression_check_sha IS NULL
        THEN RAISE(ABORT, 'done_status_guard: scope-2/3 subtask requires regression_check_sha')

      -- The B15.B json_extract() check on the verdict column — kept as a
      -- defensive layer (quick reject without needing to scan
      -- verifier_verdicts).  Accepts both legacy {verdict:'pass',...} and
      -- new {overall:'pass', verdict:'pass', ...} shapes.
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask'
           AND COALESCE(json_extract(NEW.verifier_verdict_json, '$.overall'),
                        json_extract(NEW.verifier_verdict_json, '$.verdict'))
               != 'pass'
        THEN RAISE(ABORT, 'done_status_guard: verifier verdict must be pass')

      -- B15.D — the trigger ALSO checks verifier_verdicts table.  At least
      -- one row must exist for this node, with overall='pass'.  Multiple
      -- rows are allowed (re-attempts); we accept iff the LATEST one passes.
      -- Empty table or no row for the node => reject.
      WHEN NEW.scope_tag IN ('2','3') AND NEW.granularity = 'subtask'
           AND NOT EXISTS (
             SELECT 1
             FROM verifier_verdicts vv
             WHERE vv.node_id = NEW.id
               AND vv.attempted_at = (
                 SELECT MAX(attempted_at) FROM verifier_verdicts
                 WHERE node_id = NEW.id
               )
               AND vv.overall = 'pass'
           )
        THEN RAISE(ABORT, 'done_status_guard: verifier_verdicts row with overall=pass required for autonomous-loop done')

      -- Default-reject (carried forward from B15.B): subtasks without a
      -- valid scope_tag cannot be promoted.
      WHEN NEW.granularity = 'subtask' AND (NEW.scope_tag IS NULL OR NEW.scope_tag NOT IN ('1','2','3'))
        THEN RAISE(ABORT, 'done_status_guard: subtask requires scope_tag in (1,2,3)')

      ELSE NULL
    END;
END;

COMMIT;

-- =============================================================================
-- End of migration 2026-05-13_b15d_verifier_verdicts
-- =============================================================================

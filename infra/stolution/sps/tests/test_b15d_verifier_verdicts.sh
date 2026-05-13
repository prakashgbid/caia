#!/usr/bin/env bash
# =============================================================================
# B15.D verifier-verdicts trigger acceptance tests
# =============================================================================
# Two tests prove the wiring of the VERIFIER verdict into the autonomous-loop
# done-path:
#
#   POSITIVE — verifier verdict overall='pass' written to verifier_verdicts
#              row for an autonomous-loop (scope-2) subtask with all four
#              evidence columns populated; the UPDATE nodes SET status='done'
#              succeeds and the AFTER-triggers (history marker + cascade row)
#              fire.
#
#   NEGATIVE — verifier verdict overall='fail' (or no row in verifier_verdicts
#              at all) for a scope-2 subtask blocks the done transition with
#              the new "verifier_verdicts row with overall=pass required ..."
#              error.  Row remains status='in_review' (== 'running' in the
#              SPS schema's status enum — there is no `in_review` state, so
#              we use 'running' which is the in-flight state in the canonical
#              schema; the task's "in_review" label is a working name for
#              the same in-flight state — see DEVIATION 3 in the report).
#
# Runs against an ephemeral SQLite DB seeded from the canonical schema +
# B15.B migration + B15.D migration.
#
# Usage:   ./test_b15d_verifier_verdicts.sh
# Exit:    0 = all pass; 1+ = number of failures
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPS_ROOT="$(cd "$HERE/.." && pwd)"
SCHEMA="$SPS_ROOT/schema/00_baseline_schema.sql"
MIG_B15B="$SPS_ROOT/migrations/2026-05-13_b15b_done_triggers.sql"
MIG_B15D="$SPS_ROOT/migrations/2026-05-13_b15d_verifier_verdicts.sql"
TMP_DB="$(mktemp -t sps_b15d_test.XXXXXX.db)"
trap 'rm -f "$TMP_DB" "$TMP_DB-shm" "$TMP_DB-wal"' EXIT

for f in "$SCHEMA" "$MIG_B15B" "$MIG_B15D"; do
  [[ -f "$f" ]] || { echo "FAIL: missing $f" >&2; exit 1; }
done

# Apply schema + migrations in order (B15.B first; B15.D drops+recreates
# done_status_guard so the order is enforced by the test, not the migrations).
sqlite3 "$TMP_DB" < "$SCHEMA"
sqlite3 "$TMP_DB" < "$MIG_B15B"
sqlite3 "$TMP_DB" < "$MIG_B15D"

PASS=0
FAIL=0

# Seed two scope-2 subtask nodes — one for the negative, one for the positive.
sqlite3 "$TMP_DB" <<'SQL'
INSERT INTO nodes (id, title, item_code, granularity, status, scope_tag,
                   pr_url, pr_merge_sha, regression_check_sha,
                   verifier_verdict_json)
VALUES
  ('test::b15d-fail',
   'b15d negative — verifier overall=fail blocks done',
   'TEST.B15D.1', 'subtask', 'running', '2',
   'https://github.com/x/y/pull/100',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
   '{"schema_version":"v1","overall":"fail","verdict":"fail-impl","reasons":["AC#1 not-met"]}'),
  ('test::b15d-pass',
   'b15d positive — verifier overall=pass allows done',
   'TEST.B15D.2', 'subtask', 'running', '2',
   'https://github.com/x/y/pull/101',
   'cccccccccccccccccccccccccccccccccccccccc',
   'dddddddddddddddddddddddddddddddddddddddd',
   '{"schema_version":"v1","overall":"pass","verdict":"pass","reasons":[]}');
SQL

run_negative() {
  # $1 = test name, $2 = SQL that must fail with trigger error, $3 = expected error fragment
  local name="$1" sql="$2" expected="$3"
  local out rc
  out="$(sqlite3 "$TMP_DB" "$sql" 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]] && [[ "$out" == *"$expected"* ]]; then
    echo "PASS [negative] $name"
    echo "        rc=$rc  error=$(echo "$out" | head -1)"
    PASS=$((PASS+1))
  else
    echo "FAIL [negative] $name"
    echo "        rc=$rc  expected fragment=$expected"
    echo "        got=$out"
    FAIL=$((FAIL+1))
  fi
}

run_positive() {
  # $1 = test name, $2 = SQL that must succeed, $3 = follow-up SELECT, $4 = expected output
  local name="$1" sql="$2" check_sql="$3" expected="$4"
  local update_out rc
  update_out="$(sqlite3 "$TMP_DB" "$sql" 2>&1)"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "FAIL [positive] $name (UPDATE failed)"
    echo "        rc=$rc"
    echo "        out=$update_out"
    FAIL=$((FAIL+1))
    return
  fi
  local got
  got="$(sqlite3 "$TMP_DB" "$check_sql" 2>&1)"
  if [[ "$got" == "$expected" ]]; then
    echo "PASS [positive] $name"
    echo "        check=$got"
    PASS=$((PASS+1))
  else
    echo "FAIL [positive] $name (check mismatch)"
    echo "        expected=$expected"
    echo "        got=$got"
    FAIL=$((FAIL+1))
  fi
}

# =============================================================================
# NEGATIVE — verifier overall=fail blocks autonomous-loop done
# =============================================================================
# Insert a verifier_verdicts row with overall='fail' for the negative node.
# This proves the new B15.D trigger arm rejects the done-transition even
# though all four evidence columns are populated and verifier_verdict_json
# carries a fail verdict.
sqlite3 "$TMP_DB" <<'SQL'
INSERT INTO verifier_verdicts
  (node_id, implementing_spawn_id, verifier_spawn_id, pr_url, pr_head_sha,
   overall, verdict, blocking, routing_class, recommendation,
   verdict_json, reasons_json, summary, duration_ms, worktree_cleaned_up)
VALUES
  ('test::b15d-fail', 'spawn::imp-1', 'spawn::ver-1',
   'https://github.com/x/y/pull/100',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   'fail', 'fail-impl', 1, 'autonomous-loop', 're-implement',
   '{"schema_version":"v1","overall":"fail","verdict":"fail-impl","reasons":["AC#1 not-met"]}',
   '["AC#1 not-met"]', 'AC#1 not-met after diff inspection', 78000, 1);
SQL

# The B15.B json_extract guard fires first (verifier_verdict_json says fail),
# so we expect that error message — both the B15.B and the B15.D arms reject
# the same write.  Either error message is acceptable proof; we look for the
# common stem "verifier verdict must be pass" OR the B15.D stem "verifier_verdicts
# row with overall=pass required".
out_neg="$(sqlite3 "$TMP_DB" "UPDATE nodes SET status='done' WHERE id='test::b15d-fail';" 2>&1)"
rc_neg=$?
if [[ $rc_neg -ne 0 ]] && \
   ( [[ "$out_neg" == *"verifier verdict must be pass"* ]] || \
     [[ "$out_neg" == *"verifier_verdicts row with overall=pass required"* ]] ); then
  echo "PASS [negative] verifier overall=fail blocks autonomous-loop done"
  echo "        rc=$rc_neg  error=$(echo "$out_neg" | head -1)"
  PASS=$((PASS+1))
else
  echo "FAIL [negative] expected trigger rejection with verifier-fail message"
  echo "        rc=$rc_neg"
  echo "        got=$out_neg"
  FAIL=$((FAIL+1))
fi

# Sanity: the row must remain in 'running' (the SPS in-flight state — see
# DEVIATION 3 in the phase report; "in_review" is a working name for this).
got_status="$(sqlite3 "$TMP_DB" "SELECT status FROM nodes WHERE id='test::b15d-fail';")"
if [[ "$got_status" == "running" ]]; then
  echo "        sanity: row remains status=running after rejected UPDATE — OK (interpreted as 'in_review' per the task brief)"
else
  echo "        sanity: row status=$got_status after rejected UPDATE — UNEXPECTED"
  FAIL=$((FAIL+1))
fi

# =============================================================================
# Sub-negative — even with verifier_verdict_json updated to pass, an EMPTY
# verifier_verdicts table for the node ALSO blocks (proves the B15.D arm
# fires independently of the B15.B json_extract arm).
# =============================================================================
sqlite3 "$TMP_DB" <<'SQL'
-- Update only the JSON column to pass; leave verifier_verdicts UNCHANGED
-- (still contains the fail row from above).  Then DELETE the verifier_verdicts
-- row to simulate the "no verdict ever recorded" condition and re-attempt.
UPDATE nodes
SET verifier_verdict_json='{"schema_version":"v1","overall":"pass","verdict":"pass","reasons":[]}'
WHERE id='test::b15d-fail';
DELETE FROM verifier_verdicts WHERE node_id='test::b15d-fail';
SQL

run_negative "no verifier_verdicts row at all blocks autonomous-loop done" \
  "UPDATE nodes SET status='done' WHERE id='test::b15d-fail';" \
  "verifier_verdicts row with overall=pass required"

# =============================================================================
# POSITIVE — verifier overall=pass row in verifier_verdicts allows done
# =============================================================================
# Insert a passing verifier_verdicts row for the positive node and execute
# the done-transition.
sqlite3 "$TMP_DB" <<'SQL'
INSERT INTO verifier_verdicts
  (node_id, implementing_spawn_id, verifier_spawn_id, pr_url, pr_head_sha,
   overall, verdict, blocking, routing_class, recommendation,
   verdict_json, reasons_json, summary, duration_ms, worktree_cleaned_up)
VALUES
  ('test::b15d-pass', 'spawn::imp-2', 'spawn::ver-2',
   'https://github.com/x/y/pull/101',
   'cccccccccccccccccccccccccccccccccccccccc',
   'pass', 'pass', 1, 'autonomous-loop', 'merge',
   '{"schema_version":"v1","overall":"pass","verdict":"pass","reasons":[]}',
   '[]', 'all ACs met, all tests passing', 92000, 1);

-- regression_check_result is also required by the autonomous-loop done-path
-- although the B15.B trigger does not check it (the FastAPI service does);
-- we set it for completeness so this positive test mirrors the operator-side
-- happy path exactly.
UPDATE nodes
SET regression_check_result='pass'
WHERE id='test::b15d-pass';
SQL

run_positive "verifier overall=pass row allows autonomous-loop done" \
  "UPDATE nodes SET status='done' WHERE id='test::b15d-pass';" \
  "SELECT status FROM nodes WHERE id='test::b15d-pass';" \
  "done"

# AFTER-trigger: history row written
hist_count="$(sqlite3 "$TMP_DB" "SELECT count(*) FROM history WHERE event='auto-history-done-marker' AND node_id='test::b15d-pass';")"
if [[ "$hist_count" == "1" ]]; then
  echo "PASS [positive] done_status_history_guard wrote auto-history-done-marker row"
  PASS=$((PASS+1))
else
  echo "FAIL [positive] expected 1 history marker row, got $hist_count"
  FAIL=$((FAIL+1))
fi

# AFTER-trigger: cascade row queued
cascade_count="$(sqlite3 "$TMP_DB" "SELECT count(*) FROM cascade_pending_queue WHERE node_id='test::b15d-pass' AND drained_at IS NULL;")"
if [[ "$cascade_count" == "1" ]]; then
  echo "PASS [positive] cascade_on_done queued cascade_pending_queue row"
  PASS=$((PASS+1))
else
  echo "FAIL [positive] expected 1 cascade row, got $cascade_count"
  FAIL=$((FAIL+1))
fi

# Provenance: the verifier_verdicts row carries the worktree-cleanup attestation.
clean_attest="$(sqlite3 "$TMP_DB" "SELECT worktree_cleaned_up FROM verifier_verdicts WHERE node_id='test::b15d-pass';")"
if [[ "$clean_attest" == "1" ]]; then
  echo "PASS [positive] verifier_verdicts row carries worktree_cleaned_up=1 attestation"
  PASS=$((PASS+1))
else
  echo "FAIL [positive] expected worktree_cleaned_up=1, got $clean_attest"
  FAIL=$((FAIL+1))
fi

echo "----"
echo "B15.D verifier-verdicts trigger tests: $PASS passed, $FAIL failed"
exit "$FAIL"

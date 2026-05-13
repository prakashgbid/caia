#!/usr/bin/env bash
# =============================================================================
# B15.M trigger acceptance tests
# =============================================================================
# Three negative tests prove that ad-hoc
#   sqlite3 sps.db "UPDATE nodes SET status='done' WHERE id=?"
# is REJECTED with the trigger error.  One positive test proves that the
# contract-honoring path (all four evidence columns populated, verifier_verdict
# = pass, granularity=subtask) succeeds and that the AFTER-triggers fire
# (history marker row + cascade_pending_queue row).
#
# Runs against an ephemeral SQLite DB seeded from the canonical schema +
# applied migration so the test is self-contained and does not mutate the
# host's ~/.sps/sps.db.
#
# Usage:
#   ./test_b15b_done_triggers.sh
# Exit codes:
#   0  all tests passed
#   1+ number of failed tests
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPS_ROOT="$(cd "$HERE/.." && pwd)"
SCHEMA="$SPS_ROOT/schema/00_baseline_schema.sql"
MIG="$SPS_ROOT/migrations/2026-05-13_b15b_done_triggers.sql"
TMP_DB="$(mktemp -t sps_test.XXXXXX.db)"
trap 'rm -f "$TMP_DB" "$TMP_DB-shm" "$TMP_DB-wal"' EXIT

if [[ ! -f "$SCHEMA" ]]; then
  echo "FAIL: schema file not found at $SCHEMA" >&2
  exit 1
fi
if [[ ! -f "$MIG" ]]; then
  echo "FAIL: migration file not found at $MIG" >&2
  exit 1
fi

sqlite3 "$TMP_DB" < "$SCHEMA"
sqlite3 "$TMP_DB" < "$MIG"

# Seed two test nodes — one scope-1 subtask, one scope-2 subtask.  Both start
# in 'running' so the trigger fires on the UPDATE OF status to 'done'.
# Direct INSERTs do NOT trigger done_status_guard because the trigger is
# scoped to UPDATE OF status, matching the design's threat model
# (ad-hoc UPDATE is the door being closed).
sqlite3 "$TMP_DB" <<'SQL'
INSERT INTO nodes (id, title, item_code, granularity, status, scope_tag)
VALUES
  ('test::scope1-subtask', 'scope-1 test', 'TEST.1', 'subtask', 'running', '1'),
  ('test::scope2-subtask', 'scope-2 test', 'TEST.2', 'subtask', 'running', '2'),
  ('test::scope2-subtask-pass', 'scope-2 happy path', 'TEST.3', 'subtask', 'running', '2');
SQL

PASS=0
FAIL=0

run_negative() {
  # $1 = test name, $2 = SQL that must fail with trigger error, $3 = expected error fragment
  local name="$1" sql="$2" expected="$3"
  local out
  out="$(sqlite3 "$TMP_DB" "$sql" 2>&1)"
  local rc=$?
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
  # $1 = test name, $2 = SQL that must succeed, $3 = follow-up SELECT proving state, $4 = expected output
  local name="$1" sql="$2" check_sql="$3" expected="$4"
  local update_out
  update_out="$(sqlite3 "$TMP_DB" "$sql" 2>&1)"
  local rc=$?
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

# -------------------------------------------------------------------------
# Negative 1: scope-2 subtask without pr_url is REJECTED
# -------------------------------------------------------------------------
run_negative "scope-2 subtask without pr_url is rejected" \
  "UPDATE nodes SET status='done' WHERE id='test::scope2-subtask';" \
  "done_status_guard: scope-2/3 subtask requires pr_url"

# Confirm the row is still 'running'
got_status="$(sqlite3 "$TMP_DB" "SELECT status FROM nodes WHERE id='test::scope2-subtask';")"
if [[ "$got_status" == "running" ]]; then
  echo "        sanity: row remains status=running after rejected UPDATE — OK"
else
  echo "        sanity: row status=$got_status after rejected UPDATE — UNEXPECTED"
  FAIL=$((FAIL+1))
fi

# -------------------------------------------------------------------------
# Negative 2: scope-2 subtask with pr_url + pr_merge_sha but verifier verdict = fail
# -------------------------------------------------------------------------
sqlite3 "$TMP_DB" <<'SQL'
UPDATE nodes
SET pr_url='https://github.com/x/y/pull/1',
    pr_merge_sha='deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    verifier_verdict_json='{"verdict":"fail-impl","rationale":"tests failed"}',
    regression_check_sha='cafebabecafebabecafebabecafebabecafebabe'
WHERE id='test::scope2-subtask';
SQL
run_negative "scope-2 subtask with verifier verdict != pass is rejected" \
  "UPDATE nodes SET status='done' WHERE id='test::scope2-subtask';" \
  "done_status_guard: verifier verdict must be pass"

# -------------------------------------------------------------------------
# Negative 3: scope-1 subtask without pr_url is REJECTED
# -------------------------------------------------------------------------
run_negative "scope-1 subtask without pr_url is rejected" \
  "UPDATE nodes SET status='done' WHERE id='test::scope1-subtask';" \
  "done_status_guard: scope-1 subtask requires pr_url"

# -------------------------------------------------------------------------
# Positive: scope-2 subtask with the FULL four-way AND honoured succeeds and
# triggers the AFTER-triggers (history marker + cascade row).
# -------------------------------------------------------------------------
sqlite3 "$TMP_DB" <<'SQL'
UPDATE nodes
SET pr_url='https://github.com/x/y/pull/42',
    pr_merge_sha='1111111111111111111111111111111111111111',
    verifier_verdict_json='{"verdict":"pass","rationale":"all checks green"}',
    regression_check_sha='2222222222222222222222222222222222222222',
    regression_check_result='pass'
WHERE id='test::scope2-subtask-pass';
SQL

run_positive "contract-honoring UPDATE succeeds" \
  "UPDATE nodes SET status='done' WHERE id='test::scope2-subtask-pass';" \
  "SELECT status FROM nodes WHERE id='test::scope2-subtask-pass';" \
  "done"

# AFTER-trigger 1 — done_status_history_guard wrote a history row
history_count="$(sqlite3 "$TMP_DB" "SELECT count(*) FROM history WHERE event='auto-history-done-marker' AND node_id='test::scope2-subtask-pass';")"
if [[ "$history_count" == "1" ]]; then
  echo "PASS [positive] done_status_history_guard wrote auto-history-done-marker row"
  PASS=$((PASS+1))
else
  echo "FAIL [positive] expected 1 auto-history-done-marker row, got $history_count"
  FAIL=$((FAIL+1))
fi

# AFTER-trigger 2 — cascade_on_done queued a cascade row
cascade_count="$(sqlite3 "$TMP_DB" "SELECT count(*) FROM cascade_pending_queue WHERE node_id='test::scope2-subtask-pass' AND drained_at IS NULL;")"
if [[ "$cascade_count" == "1" ]]; then
  echo "PASS [positive] cascade_on_done queued cascade_pending_queue row"
  PASS=$((PASS+1))
else
  echo "FAIL [positive] expected 1 open cascade_pending_queue row, got $cascade_count"
  FAIL=$((FAIL+1))
fi

# -------------------------------------------------------------------------
# Result
# -------------------------------------------------------------------------
echo "----"
echo "B15.M trigger tests: $PASS passed, $FAIL failed"
exit "$FAIL"

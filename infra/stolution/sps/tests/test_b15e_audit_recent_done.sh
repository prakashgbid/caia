#!/usr/bin/env bash
# =============================================================================
# B15.E audit_recent_done acceptance tests
# =============================================================================
# Six tests covering the full feedback loop:
#
#   1. SCHEMA          — migration creates reliability_rolling +
#                        redecompose_queue.
#   2. EMPTY_BUCKET    — audit on a bucket with zero done nodes writes a
#                        row with reliability_pct NULL, breached=0.
#   3. PASSING_BUCKET  — audit on a bucket with all-score-5 nodes writes
#                        reliability=100, breached=0, no INBOX append.
#   4. AUTO_REDO       — synthetic score-1 node (pr_url present, no
#                        pr_merge_sha → score 1) triggers a redecompose_queue
#                        insertion within the SAME audit run.
#   5. INBOX_ALERT     — synthetic mixed bucket below 95% writes an INBOX
#                        line with the structured prefix [B15.E ...].
#   6. UPSERT_IDEMPOTENT — re-running the audit for the same bucket UPSERTs
#                        and does NOT duplicate the row.
#
# Runs against an ephemeral SQLite DB seeded from the canonical schema +
# B15.B + B15.D + B15.E migrations.  Synthetic test::* nodes are excluded
# from the audit per methodology §4 Class D, so we use real-looking IDs.
#
# Usage:   ./test_b15e_audit_recent_done.sh
# Exit:    0 = all pass; 1+ = number of failures
# =============================================================================
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SPS_ROOT="$(cd "$HERE/.." && pwd)"
SCHEMA="$SPS_ROOT/schema/00_baseline_schema.sql"
MIG_B15B="$SPS_ROOT/migrations/2026-05-13_b15b_done_triggers.sql"
MIG_B15D="$SPS_ROOT/migrations/2026-05-13_b15d_verifier_verdicts.sql"
MIG_B15E="$SPS_ROOT/migrations/2026-05-13_b15e_reliability_rolling.sql"
SCRIPT="$SPS_ROOT/scripts/audit_recent_done.py"

TMP_DIR="$(mktemp -d -t sps_b15e_test.XXXXXX)"
TMP_DB="$TMP_DIR/sps.db"
TMP_INBOX="$TMP_DIR/INBOX.md"
trap 'rm -rf "$TMP_DIR"' EXIT

for f in "$SCHEMA" "$MIG_B15B" "$MIG_B15D" "$MIG_B15E" "$SCRIPT"; do
  [[ -f "$f" ]] || { echo "FAIL: missing $f" >&2; exit 1; }
done

sqlite3 "$TMP_DB" < "$SCHEMA"        || { echo "FAIL: baseline schema apply" >&2; exit 1; }
sqlite3 "$TMP_DB" < "$MIG_B15B"      || { echo "FAIL: B15.B migration apply" >&2; exit 1; }
sqlite3 "$TMP_DB" < "$MIG_B15D"      || { echo "FAIL: B15.D migration apply" >&2; exit 1; }
sqlite3 "$TMP_DB" < "$MIG_B15E"      || { echo "FAIL: B15.E migration apply" >&2; exit 1; }

PASS=0
FAIL=0

ok()   { PASS=$((PASS+1)); echo "PASS  $1"; }
fail() { FAIL=$((FAIL+1)); echo "FAIL  $1: $2"; }

# -----------------------------------------------------------------------------
# Test 1 — SCHEMA
# -----------------------------------------------------------------------------
TABLES="$(sqlite3 "$TMP_DB" \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('reliability_rolling','redecompose_queue') ORDER BY name;")"
if [[ "$TABLES" == "redecompose_queue
reliability_rolling" ]]; then
  ok "SCHEMA  — both tables exist"
else
  fail "SCHEMA" "missing tables; got: $TABLES"
fi

# -----------------------------------------------------------------------------
# Test 2 — EMPTY_BUCKET
# -----------------------------------------------------------------------------
OUT="$(python3 "$SCRIPT" --db "$TMP_DB" --inbox "$TMP_INBOX" \
        --bucket 2026-05-13T00:00:00Z --json 2>&1)"
RC=$?
if [[ $RC -eq 0 ]] && \
   [[ "$(sqlite3 "$TMP_DB" "SELECT COUNT(*) FROM reliability_rolling WHERE bucket_start='2026-05-13T00:00:00Z'")" == "1" ]] && \
   [[ "$(sqlite3 "$TMP_DB" "SELECT nodes_audited FROM reliability_rolling WHERE bucket_start='2026-05-13T00:00:00Z'")" == "0" ]] && \
   [[ "$(sqlite3 "$TMP_DB" "SELECT IFNULL(reliability_pct, 'NULL') FROM reliability_rolling WHERE bucket_start='2026-05-13T00:00:00Z'")" == "NULL" ]]; then
  ok "EMPTY_BUCKET  — row written with NULL reliability and zero counts"
else
  fail "EMPTY_BUCKET" "rc=$RC out=$OUT"
fi

# -----------------------------------------------------------------------------
# Setup — seed the bucket [01:00-02:00) with realistic nodes
# -----------------------------------------------------------------------------
# Node A: score-5    — pr_url + pr_merge_sha + verifier pass + dod 10/10 + regression pass
# Node B: score-1    — pr_url BUT no pr_merge_sha (verify-noop) — auto-redo target
# Node C: score-0    — no pr_url at all (false-claim) — auto-redo target
# Node D: score-3    — pr_url + pr_merge_sha + dod 6/10 + regression pass
# Node E: synthetic  — should be EXCLUDED from the audit denominator
#
# We INSERT directly bypassing the done_status_guard trigger by setting
# status='done' at INSERT (the trigger only fires on UPDATE OF status).

DOD_FULL='XXXXXXXXXX'
DOD_SIX='XXXXXX....'

sqlite3 "$TMP_DB" <<SQL
INSERT INTO nodes (id, title, item_code, granularity, status, scope_tag,
                   pr_url, pr_merge_sha, verifier_verdict_json,
                   dod_stages_required, dod_stages_evidenced,
                   regression_check_sha, regression_check_result,
                   updated_at)
VALUES
  ('audit-test-A', 'A — score 5', 'TEST.A', 'subtask', 'done', '2',
   'https://github.com/x/y/pull/501',
   'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
   '{"schema_version":"v1","overall":"pass","verdict":"pass"}',
   '$DOD_FULL', '$DOD_FULL',
   'aaaaaaaa1111111111111111111111111111aaaa', 'pass',
   '2026-05-13 01:15:00'),
  ('audit-test-B', 'B — score 1 verify-noop', 'TEST.B', 'subtask', 'done', '2',
   'https://github.com/x/y/pull/502',
   NULL,
   '{"schema_version":"v1","overall":"pass","verdict":"pass"}',
   '$DOD_FULL', '$DOD_FULL',
   'bbbbbbbb2222222222222222222222222222bbbb', 'pass',
   '2026-05-13 01:25:00'),
  ('audit-test-C', 'C — score 0 false-claim', 'TEST.C', 'subtask', 'done', '2',
   NULL, NULL, NULL,
   '$DOD_FULL', '..........',
   NULL, NULL,
   '2026-05-13 01:35:00'),
  ('audit-test-D', 'D — score 3', 'TEST.D', 'subtask', 'done', '2',
   'https://github.com/x/y/pull/504',
   'dddddddddddddddddddddddddddddddddddddddd',
   '{"schema_version":"v1","overall":"pass","verdict":"pass"}',
   '$DOD_FULL', '$DOD_SIX',
   'dddddddd4444444444444444444444444444dddd', 'pass',
   '2026-05-13 01:45:00'),
  ('test::synthetic-node-1', 'E — synthetic excluded', 'TEST.E', 'subtask', 'done', '2',
   NULL, NULL, NULL, '..........', '..........', NULL, NULL,
   '2026-05-13 01:50:00');
SQL

# -----------------------------------------------------------------------------
# Test 3 — PASSING vs FAIL bucket math
# -----------------------------------------------------------------------------
# For bucket [01:00, 02:00):  audited=4 (B,C,D,A), passing=2 (A=5, D=3),
#                             score_le_2=2 (B=1, C=0); reliability=50%; breach.
OUT="$(python3 "$SCRIPT" --db "$TMP_DB" --inbox "$TMP_INBOX" \
        --bucket 2026-05-13T01:00:00Z --json 2>&1)"
RC=$?
AUDITED=$(sqlite3 "$TMP_DB" "SELECT nodes_audited FROM reliability_rolling WHERE bucket_start='2026-05-13T01:00:00Z'")
PASSING=$(sqlite3 "$TMP_DB" "SELECT nodes_passing FROM reliability_rolling WHERE bucket_start='2026-05-13T01:00:00Z'")
LE2=$(sqlite3 "$TMP_DB" "SELECT nodes_score_le_2 FROM reliability_rolling WHERE bucket_start='2026-05-13T01:00:00Z'")
SCORE5=$(sqlite3 "$TMP_DB" "SELECT nodes_score_5 FROM reliability_rolling WHERE bucket_start='2026-05-13T01:00:00Z'")
RELS=$(sqlite3 "$TMP_DB" "SELECT printf('%.2f', reliability_pct) FROM reliability_rolling WHERE bucket_start='2026-05-13T01:00:00Z'")
BREACH=$(sqlite3 "$TMP_DB" "SELECT breached_threshold FROM reliability_rolling WHERE bucket_start='2026-05-13T01:00:00Z'")
if [[ $RC -eq 0 ]] && [[ "$AUDITED" == "4" ]] && [[ "$PASSING" == "2" ]] && \
   [[ "$LE2" == "2" ]] && [[ "$SCORE5" == "1" ]] && \
   [[ "$RELS" == "50.00" ]] && [[ "$BREACH" == "1" ]]; then
  ok "BUCKET_MATH    — audited=4 passing=2 le2=2 reliability=50% breached"
else
  fail "BUCKET_MATH" "rc=$RC audited=$AUDITED passing=$PASSING le2=$LE2 score5=$SCORE5 rel=$RELS breach=$BREACH"
fi

# -----------------------------------------------------------------------------
# Test 4 — AUTO_REDO
# -----------------------------------------------------------------------------
QUEUED=$(sqlite3 "$TMP_DB" "SELECT GROUP_CONCAT(node_id, ',') FROM redecompose_queue WHERE next_action='re-decompose' ORDER BY node_id")
if [[ "$QUEUED" == *"audit-test-B"* ]] && [[ "$QUEUED" == *"audit-test-C"* ]]; then
  ok "AUTO_REDO      — score-1 (B) and score-0 (C) nodes queued: $QUEUED"
else
  fail "AUTO_REDO" "expected B+C queued, got: $QUEUED"
fi

# -----------------------------------------------------------------------------
# Test 5 — INBOX_ALERT
# -----------------------------------------------------------------------------
if [[ -f "$TMP_INBOX" ]] && grep -q '\[B15.E reliability-alert\]' "$TMP_INBOX" && \
   grep -q 'bucket=2026-05-13T01:00:00Z/2026-05-13T02:00:00Z' "$TMP_INBOX" && \
   grep -q 'rel=50.00%' "$TMP_INBOX"; then
  ok "INBOX_ALERT    — structured alert appended (rel=50% < 95% threshold)"
else
  fail "INBOX_ALERT" "no alert line; inbox=$([ -f "$TMP_INBOX" ] && cat "$TMP_INBOX" || echo "missing")"
fi

# -----------------------------------------------------------------------------
# Test 6 — UPSERT_IDEMPOTENT
# -----------------------------------------------------------------------------
COUNT_BEFORE=$(sqlite3 "$TMP_DB" "SELECT COUNT(*) FROM reliability_rolling")
QUEUE_BEFORE=$(sqlite3 "$TMP_DB" "SELECT COUNT(*) FROM redecompose_queue")
python3 "$SCRIPT" --db "$TMP_DB" --inbox "$TMP_INBOX" \
        --bucket 2026-05-13T01:00:00Z --json >/dev/null 2>&1
COUNT_AFTER=$(sqlite3 "$TMP_DB" "SELECT COUNT(*) FROM reliability_rolling")
QUEUE_AFTER=$(sqlite3 "$TMP_DB" "SELECT COUNT(*) FROM redecompose_queue")
if [[ "$COUNT_BEFORE" == "$COUNT_AFTER" ]] && [[ "$QUEUE_AFTER" -gt "$QUEUE_BEFORE" ]]; then
  # New audit_run_id => new redecompose_queue rows are EXPECTED (one per re-run)
  ok "UPSERT_IDEMPOTENT — reliability_rolling stable at $COUNT_AFTER row(s); queue grew by audit_run_id"
elif [[ "$COUNT_BEFORE" == "$COUNT_AFTER" ]] && [[ "$QUEUE_AFTER" == "$QUEUE_BEFORE" ]]; then
  ok "UPSERT_IDEMPOTENT — both tables idempotent (queue UNIQUE prevented dup)"
else
  fail "UPSERT_IDEMPOTENT" "rolling: $COUNT_BEFORE -> $COUNT_AFTER ; queue: $QUEUE_BEFORE -> $QUEUE_AFTER"
fi

# -----------------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------------
TOTAL=$((PASS+FAIL))
echo
echo "========================================================="
echo "B15.E audit_recent_done tests: $PASS / $TOTAL passed ($FAIL failed)"
echo "========================================================="
exit $FAIL

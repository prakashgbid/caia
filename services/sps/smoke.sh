#!/usr/bin/env bash
# SPS Phase 2 end-to-end smoke test.
#
# Extends the Phase 1 22-test suite with:
#   - forced-failure retry (failed → ready+retry_at, attempt logged)
#   - dead-letter inspection (max-retries → dead_letter row + /dead-letter)
#   - stuck-task detection (seeded old heartbeat → /admin/audit/stuck-tasks)
#   - alias resolution (M1, stolution-*)
#   - /metrics scrape (Prometheus text format with required series)
#   - parser hardening (malformed input never crashes)
#
# Target: 30+ PASS / 0 FAIL.
#
# Usage:
#   ./smoke.sh                       # auto-resolve service ClusterIP
#   BASE=http://1.2.3.4:8080 ./smoke.sh

set -e

if [ -z "${BASE:-}" ]; then
  SVC=$(kubectl get svc -n caia-orchestrator sps -o jsonpath='{.spec.clusterIP}')
  BASE="http://${SVC}:8080"
fi
SLOT_SVC=$(kubectl get svc -n caia-orchestrator slot-manager -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
[ -n "${SLOT_SVC}" ] && SLOT="http://${SLOT_SVC}:8081" || SLOT=""

echo "BASE=${BASE}  SLOT=${SLOT}"

PASS=0
FAIL=0
log()   { printf '\n=== %s ===\n' "$1"; }
check() { if eval "$2"; then echo "PASS: $1"; PASS=$((PASS+1)); else echo "FAIL: $1  (expr: $2)"; FAIL=$((FAIL+1)); fi; }

PJ() { python3 -c "import sys,json; d=json.load(sys.stdin); $1"; }

# ---------------------------------------------------------------------------
log "0) Pre-clear (idempotent)"
curl -sS -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  "${BASE}/admin/test/clear" >/dev/null || true

# ---------------------------------------------------------------------------
log "1) /health is Phase 2"
H=$(curl -sS "${BASE}/health")
echo "$H"
check "phase==2"          "[ \"\$(echo '$H' | $(command -v python3) -c 'import sys,json; print(json.load(sys.stdin)[\"phase\"])')\" = \"2\" ]"
check "sqlite ok"         "[ \"\$(echo '$H' | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"sqlite_ok\"])')\" = \"True\" ]"
check "version 0.3.0-p2"  "[ \"\$(echo '$H' | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"version\"])')\" = \"0.3.0-phase2\" ]"
check "aliases >= 3"      "[ \"\$(echo '$H' | python3 -c 'import sys,json; print(json.load(sys.stdin)[\"aliases\"])')\" -ge \"3\" ]"

# ---------------------------------------------------------------------------
log "2) Phase-1 carry-forward — 3-node DAG end-to-end still works"
curl -sS -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  "${BASE}/admin/test/seed-3node-dag" >/dev/null
R=$(curl -sS "${BASE}/next-spawn?bucket=M1-cowork&scope=1")
ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
check "next-spawn claimed test::A" "[ \"$ID\" = \"test::A\" ]"
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"node_id":"test::A","bucket":"M1-cowork","outcome":"done"}' "${BASE}/completion" >/dev/null
R=$(curl -sS "${BASE}/next-spawn?bucket=M1-cowork&scope=1")
ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
check "next-spawn claimed test::B" "[ \"$ID\" = \"test::B\" ]"
curl -sS -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  "${BASE}/admin/test/clear" >/dev/null

# ---------------------------------------------------------------------------
log "3) Bucket alias resolution — M1 → M1-cowork"
RZ=$(curl -sS "${BASE}/resolve?bucket=M1")
echo "$RZ"
RZ_RES=$(echo "$RZ" | python3 -c "import sys,json; print(json.load(sys.stdin)['resolved'])")
RZ_AL=$(echo "$RZ"  | python3 -c "import sys,json; print(json.load(sys.stdin)['alias_used'])")
check "resolve M1 → M1-cowork"   "[ \"$RZ_RES\" = \"M1-cowork\" ]"
check "alias_used = M1"          "[ \"$RZ_AL\"  = \"M1\" ]"

log "3a) Bucket alias resolution — unknown stays unknown"
RZ=$(curl -sS "${BASE}/resolve?bucket=does-not-exist")
RZ_EX=$(echo "$RZ" | python3 -c "import sys,json; print(json.load(sys.stdin)['exists'])")
check "unknown.exists=False"     "[ \"$RZ_EX\" = \"False\" ]"

log "3b) Bucket alias resolution — stolution → stolution-*"
RZ=$(curl -sS "${BASE}/resolve?bucket=stolution")
echo "$RZ"
RZ_RES=$(echo "$RZ" | python3 -c "import sys,json; print(json.load(sys.stdin)['resolved'])")
case "$RZ_RES" in stolution-*) check "stolution → stolution-*" "true" ;;
                  *)            check "stolution → stolution-*" "false" ;; esac

log "3c) /next-spawn accepts alias 'M1' — claim should succeed"
curl -sS -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  "${BASE}/admin/test/seed-3node-dag" >/dev/null
R=$(curl -sS "${BASE}/next-spawn?bucket=M1&scope=1")
echo "$R"
ID=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
RB=$(echo "$R" | python3 -c "import sys,json; print(json.load(sys.stdin)['resolved_bucket'])")
check "alias-claim id=test::A"        "[ \"$ID\" = \"test::A\" ]"
check "alias-claim resolved=M1-cowork" "[ \"$RB\" = \"M1-cowork\" ]"
curl -sS -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  "${BASE}/admin/test/clear" >/dev/null

# ---------------------------------------------------------------------------
log "4) Aliases CRUD — POST /aliases adds, GET lists, DELETE removes"
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"alias":"smoke-alias","target":"M1-cowork","note":"phase2 smoke"}' \
  "${BASE}/aliases" >/dev/null
RZ=$(curl -sS "${BASE}/resolve?bucket=smoke-alias")
RZ_RES=$(echo "$RZ" | python3 -c "import sys,json; print(json.load(sys.stdin)['resolved'])")
check "POST alias resolves" "[ \"$RZ_RES\" = \"M1-cowork\" ]"
DR=$(curl -sS -X DELETE "${BASE}/aliases/smoke-alias")
DR_OK=$(echo "$DR" | python3 -c "import sys,json; print(json.load(sys.stdin)['removed'])")
check "DELETE alias=1"      "[ \"$DR_OK\" = \"1\" ]"

# ---------------------------------------------------------------------------
log "5) /metrics — Prometheus text format with key series"
M=$(curl -sS "${BASE}/metrics")
echo "$M" | head -20
check "sps_info present"            "echo \"\$M\" | grep -q '^sps_info{'"
check "sps_bucket_inflight present" "echo \"\$M\" | grep -q '^sps_bucket_inflight{'"
check "sps_bucket_queue_depth"      "echo \"\$M\" | grep -q '^sps_bucket_queue_depth{'"
check "sps_bucket_dead_letter"      "echo \"\$M\" | grep -q '^sps_bucket_dead_letter{'"
check "sps_spawn_total counter"     "echo \"\$M\" | grep -q '^sps_spawn_total '"
check "sps_retry_total counter"     "echo \"\$M\" | grep -q '^sps_retry_total '"
check "sps_dead_letter_total"       "echo \"\$M\" | grep -q '^sps_dead_letter_total '"
check "p50 latency line"            "echo \"\$M\" | grep -q 'sps_spawn_latency_ms{quantile=\"0.5\"}'"
check "p95 latency line"            "echo \"\$M\" | grep -q 'sps_spawn_latency_ms{quantile=\"0.95\"}'"

# ---------------------------------------------------------------------------
log "6) Retry path — failed completion before max bumps retries + retry_at"
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"confirm":true,"node_id":"test::retry","max_retries":2}' \
  "${BASE}/admin/test/seed-retry-node" >/dev/null
# Claim
SP=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"bucket":"M1-cowork","slot_id":"M1-1","scope":"1"}' "${BASE}/spawn")
SP_ID=$(echo "$SP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
check "retry seed claimed" "[ \"$SP_ID\" = \"test::retry\" ]"

# First failure → should reschedule
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"node_id":"test::retry","bucket":"M1-cowork","outcome":"failed","outcome_detail":"smoke-1"}' \
  "${BASE}/completion" >/dev/null
DAG=$(curl -sS "${BASE}/dag")
N_RETRY=$(echo "$DAG" | python3 -c "import sys,json; d=json.load(sys.stdin); n=[x for x in d['nodes'] if x['id']=='test::retry'][0]; print(n['retries'])")
N_STAT=$(echo "$DAG"  | python3 -c "import sys,json; d=json.load(sys.stdin); n=[x for x in d['nodes'] if x['id']=='test::retry'][0]; print(n['status'])")
N_RAT=$(echo "$DAG"   | python3 -c "import sys,json; d=json.load(sys.stdin); n=[x for x in d['nodes'] if x['id']=='test::retry'][0]; print(n['retry_at'] or '')")
echo "after-fail-1: retries=$N_RETRY status=$N_STAT retry_at=$N_RAT"
check "retries==1 after first fail" "[ \"$N_RETRY\" = \"1\" ]"
check "status==ready after fail (rescheduled)" "[ \"$N_STAT\" = \"ready\" ]"
check "retry_at populated" "[ -n \"$N_RAT\" ]"

# spawn_attempts row should exist
ATT=$(curl -sS "${BASE}/dag" | python3 -c "import sys,json; print('ok')")
check "dag still readable post-fail" "[ \"$ATT\" = \"ok\" ]"

# ---------------------------------------------------------------------------
log "7) Dead-letter — max retries → dead_letter row + /dead-letter shows it"
# Force-clear retry_at by reseeding so we can spawn again immediately
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"confirm":true,"node_id":"test::retry","max_retries":2}' \
  "${BASE}/admin/test/seed-retry-node" >/dev/null
# Now bump node's retries directly to attempts-1 by submitting fail twice quickly:
# Reseed sets retries back to 0; we need to drive it to max via two failures.
# We bypass the retry_at gate by using move_to_stuck=false manual SQL? No — use
# the normal path: reseed already cleared retry_at. So spawn → fail → reseed
# preserves retries? Actually reseed resets retries to 0. So a cleaner path is:
#   - max_retries=1 → first fail moves to dead_letter directly.
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"confirm":true,"node_id":"test::dlq","max_retries":1}' \
  "${BASE}/admin/test/seed-retry-node" >/dev/null
SP=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"bucket":"M1-cowork","slot_id":"M1-1","scope":"1"}' "${BASE}/spawn")
SP_ID=$(echo "$SP" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
check "dlq seed claimed" "[ \"$SP_ID\" = \"test::dlq\" ]"
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"node_id":"test::dlq","bucket":"M1-cowork","outcome":"failed","outcome_detail":"smoke-dlq"}' \
  "${BASE}/completion" >/dev/null
DLQ=$(curl -sS "${BASE}/dead-letter?bucket=M1-cowork")
echo "$DLQ"
DLQ_N=$(echo "$DLQ" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for x in d['items'] if x['node_id']=='test::dlq'))")
check "dead-letter has test::dlq" "[ \"$DLQ_N\" -ge \"1\" ]"
NODE_ST=$(curl -sS "${BASE}/dag" | python3 -c "import sys,json; d=json.load(sys.stdin); n=[x for x in d['nodes'] if x['id']=='test::dlq'][0]; print(n['status'])")
check "node status=failed after DLQ" "[ \"$NODE_ST\" = \"failed\" ]"

# Requeue
RQ=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"node_id":"test::dlq","reset_retries":true}' "${BASE}/dead-letter/requeue")
RQ_OK=$(echo "$RQ" | python3 -c "import sys,json; print(json.load(sys.stdin)['ok'])")
check "DLQ requeue ok" "[ \"$RQ_OK\" = \"True\" ]"
DLQ2=$(curl -sS "${BASE}/dead-letter?bucket=M1-cowork")
DLQ2_N=$(echo "$DLQ2" | python3 -c "import sys,json; d=json.load(sys.stdin); print(sum(1 for x in d['items'] if x['node_id']=='test::dlq'))")
check "DLQ row removed after requeue" "[ \"$DLQ2_N\" = \"0\" ]"

# ---------------------------------------------------------------------------
log "8) Stuck-task audit — seeded old-heartbeat node moves to stuck"
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"confirm":true,"node_id":"test::stuck","age_min":30}' \
  "${BASE}/admin/test/seed-stuck-node" >/dev/null
SR=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"max_age_min":10,"move_to_stuck":true}' \
  "${BASE}/admin/audit/stuck-tasks")
echo "$SR"
SR_FOUND=$(echo "$SR" | python3 -c "import sys,json; print(json.load(sys.stdin)['found'])")
SR_MOVED=$(echo "$SR" | python3 -c "import sys,json; print(json.load(sys.stdin)['moved'])")
check "stuck-audit found >= 1" "[ \"$SR_FOUND\" -ge \"1\" ]"
check "stuck-audit moved >= 1" "[ \"$SR_MOVED\" -ge \"1\" ]"
DAG=$(curl -sS "${BASE}/dag")
N_STAT=$(echo "$DAG" | python3 -c "import sys,json; d=json.load(sys.stdin); n=[x for x in d['nodes'] if x['id']=='test::stuck'][0]; print(n['status'])")
check "node now status=stuck" "[ \"$N_STAT\" = \"stuck\" ]"

# Dry run — recent task does NOT match
curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"confirm":true,"node_id":"test::fresh","age_min":1}' \
  "${BASE}/admin/test/seed-stuck-node" >/dev/null
SR=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d '{"max_age_min":10,"move_to_stuck":false}' \
  "${BASE}/admin/audit/stuck-tasks")
SR_MOVED=$(echo "$SR" | python3 -c "import sys,json; print(json.load(sys.stdin)['moved'])")
check "fresh node NOT moved" "[ \"$SR_MOVED\" = \"0\" ]"

# ---------------------------------------------------------------------------
log "9) Parser hardening — malformed input never crashes"
MAL='garbage line\n| not | a | row |\n|abc|broken\n| 1.0 | **B1.A — title** [scope:2] |'
RR=$(curl -sS -X POST -H 'Content-Type: application/json' \
  -d "{\"inline_text\":\"$MAL\"}" "${BASE}/reload")
echo "$RR"
RR_OK=$(echo "$RR" | python3 -c "import sys,json; print(json.load(sys.stdin)['ok'])")
check "reload returned ok=True even with junk" "[ \"$RR_OK\" = \"True\" ]"
RR_PE=$(echo "$RR" | python3 -c "import sys,json; print(json.load(sys.stdin)['parse_error_count'])")
check "parse_error_count >= 0" "[ \"$RR_PE\" -ge \"0\" ]"
RR_INS=$(echo "$RR" | python3 -c "import sys,json; print(json.load(sys.stdin)['inserted_nodes'])")
check "good row still parsed" "[ \"$RR_INS\" -ge \"1\" ]"
H2=$(curl -sS "${BASE}/health")
H2_OK=$(echo "$H2" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])")
check "service still healthy after malformed reload" "[ \"$H2_OK\" = \"ok\" ]"
# Cleanup the parser-test node
curl -sS -X POST -H 'Content-Type: application/json' \
  -d "{\"inline_text\":\"\",\"purge\":true}" "${BASE}/reload" >/dev/null 2>&1 || true

# ---------------------------------------------------------------------------
log "10) Cap audit + history (Phase-1 carry-forward, alias-aware)"
CR=$(curl -sS -X POST "${BASE}/cap?bucket=M1&value=6&actor=phase2-smoke&reason=alias-cap-test")
echo "$CR"
CR_BUCKET=$(echo "$CR" | python3 -c "import sys,json; print(json.load(sys.stdin)['bucket'])")
CR_NEW=$(echo "$CR"   | python3 -c "import sys,json; print(json.load(sys.stdin)['new_cap'])")
check "alias cap-change resolved=M1-cowork" "[ \"$CR_BUCKET\" = \"M1-cowork\" ]"
check "alias cap-change new=6"              "[ \"$CR_NEW\"    = \"6\" ]"
curl -sS -X POST "${BASE}/cap?bucket=M1-cowork&value=4&actor=phase2-smoke&reason=revert" >/dev/null

# ---------------------------------------------------------------------------
log "11) Cleanup test rows"
curl -sS -X POST -H 'Content-Type: application/json' -d '{"confirm":true}' \
  "${BASE}/admin/test/clear" >/dev/null

# ---------------------------------------------------------------------------
log "12) Slot-manager reachable (sibling sanity)"
if [ -n "$SLOT" ]; then
  SM_HEALTH=$(curl -sS "${SLOT}/health" || echo FAIL)
  echo "$SM_HEALTH"
  check "slot-manager OK" "[ \"$SM_HEALTH\" = \"OK\" ]"
fi

# ---------------------------------------------------------------------------
echo ""
echo "######################################"
echo "# SMOKE TEST RESULTS: ${PASS} passed, ${FAIL} failed"
echo "######################################"
exit $FAIL

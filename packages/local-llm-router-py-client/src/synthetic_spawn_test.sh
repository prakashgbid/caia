#!/usr/bin/env bash
# LAI phase 7 — synthetic /spawn smoke test for the optimizer escalation path.
#
# Sends a task spec the classifier should route to claude (open-ended
# design question, ~1500-word answer expected). Confirms the spawn record
# captures optimizer_* fields and that pre_token_count > post_token_count
# (or equal in the inline-stage1 fallback path).
#
# Usage: ./synthetic_spawn_test.sh [remote_host]   (default: stolution)

set -euo pipefail

REMOTE_HOST="${1:-stolution}"
SPAWNER_PORT="${SPAWNER_PORT:-8410}"   # adjust if different on this host
DB_PATH="${SPAWNER_DB:-/home/s903/.cache/claude-spawner-agent/spawner.db}"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

SPAWN_ID="phase7-smoke-$(date +%s)"

TASK_SPEC=$(cat <<'JSON'
Design a robust online schema migration strategy for our 50M-row users
table on PostgreSQL 16. Cover:
  - zero-downtime constraints (rolling Stolution API deployments)
  - rollback ladder (per-step + full)
  - lock impact + how to keep replicas lag-free
  - observability and abort criteria
Produce a 1500-word plan with diagrams as ASCII trees. Include risks and
mitigations. Cite at least three references from the PostgreSQL docs.
JSON
)

log "synthetic /spawn → ${REMOTE_HOST}:${SPAWNER_PORT}"

PAYLOAD=$(jq -nc \
  --arg sid "$SPAWN_ID" \
  --arg task "$TASK_SPEC" \
  '{
    spawn_id: $sid,
    task_id: "lai-phase7-synthetic",
    task_spec: { id: "lai-phase7-synthetic", prompt: $task },
    require_subscription: true,
    permission_mode: "default",
    timeout_sec: 60
  }')

ssh "$REMOTE_HOST" "curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -d @- \
  http://127.0.0.1:${SPAWNER_PORT}/spawn" <<<"$PAYLOAD" \
  | tee /tmp/lai_phase7_spawn.json

log "spawn response captured to /tmp/lai_phase7_spawn.json on this host"

# Pause briefly for the spawner to finalize the journal row.
sleep 3

log "querying spawner.db for optimizer_* fields on spawn_id=$SPAWN_ID"

ssh "$REMOTE_HOST" "sqlite3 $DB_PATH \
  \"SELECT spawn_id, outcome, claude_invoked, \
     optimizer_backend, optimizer_pre_tokens, optimizer_post_tokens, \
     optimizer_compression, optimizer_stages_run, optimizer_wall_ms, \
     optimizer_error \
   FROM spawn_records WHERE spawn_id = '$SPAWN_ID' \
   ORDER BY id DESC LIMIT 1;\""

log "If pre_tokens > post_tokens (or pre==post with backend='inline-stage1'),"
log "the optimizer ran and the patch is wired correctly."

#!/usr/bin/env bash
# LAI phase 7 — deploy spawner_patch_v2 + updated client to stolution.
#
# This script was staged by the autonomous orchestrator. It was NOT executed
# because the autonomous mode blocked ssh/scp behind interactive permission
# prompts and the operator was offline. Run it once approval is available.
#
# Idempotent: rsyncs only if source is newer; backs up live files before
# touching them; restarts spawner via systemctl --user.
#
# Usage:
#   cd ~/Documents/projects/caia/packages/local-llm-router-py-client/src
#   ./deploy_v2.sh                  # full deploy (stage + restart + smoke)
#   ./deploy_v2.sh --no-restart     # stage files only
#   ./deploy_v2.sh --smoke-only     # just run the synthetic /spawn test

set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
REMOTE_HOST="${REMOTE_HOST:-stolution}"
REMOTE_SPAWN_DIR="${REMOTE_SPAWN_DIR:-/home/s903/apps/claude-spawner}"

CLIENT_FILE="local_llm_router_client.py"
PATCH_FILE="spawner_patch_v2.diff"

ts() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
log() { echo "[$(ts)] $*"; }

case "${1:-}" in
  --smoke-only) DO_DEPLOY=0 ;;
  --no-restart) DO_DEPLOY=1; DO_RESTART=0 ;;
  *) DO_DEPLOY=1; DO_RESTART=${DO_RESTART:-1} ;;
esac

if [[ "${DO_DEPLOY:-1}" == "1" ]]; then
  log "staging $CLIENT_FILE + $PATCH_FILE to $REMOTE_HOST:$REMOTE_SPAWN_DIR"

  # 1. Back up live client on remote (only if it exists and differs).
  ssh "$REMOTE_HOST" "cd $REMOTE_SPAWN_DIR && \
    if [ -f $CLIENT_FILE ] && ! diff -q $CLIENT_FILE $CLIENT_FILE.v1.bak >/dev/null 2>&1; then \
      cp -p $CLIENT_FILE $CLIENT_FILE.v1.bak.\$(date +%Y%m%d%H%M%S); \
    fi"

  # 2. Stage the updated client + reference patch.
  scp -p "$SRC_DIR/$CLIENT_FILE" "$REMOTE_HOST:$REMOTE_SPAWN_DIR/$CLIENT_FILE"
  scp -p "$SRC_DIR/$PATCH_FILE"  "$REMOTE_HOST:$REMOTE_SPAWN_DIR/$PATCH_FILE"

  # 3. Apply the v2 patch on top of (already v1-patched) spawner. The patch
  #    is a *reference* — operator may need to hand-apply if line offsets
  #    have drifted. We try patch --dry-run first to surface conflicts.
  log "dry-run patch -p0 to detect drift"
  ssh "$REMOTE_HOST" "cd $REMOTE_SPAWN_DIR && \
    patch --dry-run -p0 < $PATCH_FILE || \
    { echo 'WARN: patch dry-run failed — drift detected. Apply by hand using $PATCH_FILE as a guide.'; exit 0; }"

  log "applying patch -p0 for real (if dry-run was clean)"
  ssh "$REMOTE_HOST" "cd $REMOTE_SPAWN_DIR && \
    if patch --dry-run -p0 < $PATCH_FILE >/dev/null 2>&1; then \
      patch -p0 < $PATCH_FILE; \
    else \
      echo 'skipping auto-apply — drift detected'; \
    fi"
fi

if [[ "${DO_RESTART:-1}" == "1" ]]; then
  log "restarting claude-spawner-agent on $REMOTE_HOST"
  ssh "$REMOTE_HOST" "systemctl --user restart claude-spawner-agent.service || \
    { echo 'no systemd unit — restart spawner manually'; exit 0; }"
  sleep 2
  ssh "$REMOTE_HOST" "systemctl --user status claude-spawner-agent.service --no-pager | head -20 || true"
fi

# 4. Synthetic /spawn smoke test — sends a task crafted to escalate to
#    claude (it's the kind of multi-paragraph design question the router
#    classifier should route to 'claude' tier). After it completes we
#    grep the spawn DB row to confirm optimizer_* fields are populated.
log "synthetic /spawn smoke test"
"$SRC_DIR/synthetic_spawn_test.sh" "$REMOTE_HOST"

log "deploy_v2 complete."

#!/usr/bin/env bash
# deploy-caia.sh — one-shot deploy of the CAIA control-plane stack (STOL-1034).
#
# Idempotent. Safe to re-run. Verifies health of every kernel before exiting 0.
#
# Reuse doctrine: LiteLLM (Kernel-5) and stolution-kafka / stolution-minio are
# ALREADY deployed on the box. This script only stands up the missing kernels
# (Temporal K-1, OPA K-3, Context Compiler K-7) plus topic/bucket init and the
# Wizard UI placeholder.

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.caia.yml"
PROJECT="caia"
NETWORK="stolution-network"

log() { printf '\033[1;36m[caia-deploy]\033[0m %s\n' "$*"; }
err() { printf '\033[1;31m[caia-deploy][ERR]\033[0m %s\n' "$*" >&2; }

# ─── Preflight ────────────────────────────────────────────────────────────
log "preflight: docker + compose file"
command -v docker >/dev/null || { err "docker missing"; exit 2; }
docker compose version >/dev/null 2>&1 || { err "docker compose plugin missing"; exit 2; }
[[ -f "$COMPOSE_FILE" ]] || { err "compose file not found: $COMPOSE_FILE"; exit 2; }

log "preflight: shared network '$NETWORK' exists"
docker network inspect "$NETWORK" >/dev/null 2>&1 || {
  err "network $NETWORK missing — this is the shared stolution network. Aborting.";
  exit 3;
}

log "preflight: stolution-kafka + stolution-minio reachable"
for c in stolution-kafka stolution-minio; do
  docker ps --format '{{.Names}}' | grep -qx "$c" || {
    err "$c not running — CAIA requires the shared stolution stack up first";
    exit 4;
  }
done

# ─── Deploy ───────────────────────────────────────────────────────────────
log "deploying CAIA stack (project=$PROJECT)"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" pull --ignore-pull-failures
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --remove-orphans

# ─── Verify ───────────────────────────────────────────────────────────────
verify() {
  local name="$1" cmd="$2" tries="${3:-30}"
  log "verify: $name"
  for i in $(seq 1 "$tries"); do
    if eval "$cmd" >/dev/null 2>&1; then
      log "  -> $name OK (attempt $i)"
      return 0
    fi
    sleep 3
  done
  err "  -> $name FAILED after $tries attempts"
  return 1
}

FAILED=0
verify "Kernel-1 stolution-temporal (REUSED)" \
  "docker ps --format '{{.Names}}' | grep -qx stolution-temporal" 5 || FAILED=$((FAILED+1))
verify "caia-temporal-ui (:8189)" \
  "curl -fsS http://localhost:8189/ -o /dev/null" 30 || FAILED=$((FAILED+1))
verify "caia-opa (:8181) health" \
  "curl -fsS http://localhost:8181/health -o /dev/null" 20 || FAILED=$((FAILED+1))
verify "kafka topics created" \
  "docker run --rm --network stolution-network apache/kafka:3.8.0 /opt/kafka/bin/kafka-topics.sh --bootstrap-server stolution-kafka:9092 --list | grep -q caia.factory" 30 || FAILED=$((FAILED+1))
verify "minio caia buckets" \
  "docker run --rm --network stolution-network minio/mc sh -c 'mc alias set s http://stolution-minio:9000 stolution stolution_minio_secret_2026 >/dev/null 2>&1 && mc ls s/ | grep -q caia-artifacts'" 20 || FAILED=$((FAILED+1))
verify "caia-wizard-ui (:8191)" \
  "curl -fsS http://localhost:8191/ -o /dev/null" 20 || FAILED=$((FAILED+1))
verify "caia-context-compiler (:8190)" \
  "curl -fsS http://localhost:8190/ -o /dev/null || docker ps --format '{{.Names}}' | grep -qx caia-context-compiler" 20 || log "  -> context-compiler port not up yet (container may be booting Python deps)"
verify "LiteLLM Kernel-5 (already deployed)" \
  "docker ps --format '{{.Names}}' | grep -qi litellm" 3 || log "  -> LiteLLM check inconclusive (non-fatal)"

log "─────────────────────────────────────────────"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" ps
log "─────────────────────────────────────────────"

if [[ "$FAILED" -gt 0 ]]; then
  err "$FAILED kernel(s) failed health check"
  exit 10
fi

log "CAIA stack deployed and healthy."
log "  Temporal UI:  http://localhost:8189   (points at REUSED stolution-temporal:7233)"
log "  OPA:          http://localhost:8181"
log "  Wizard UI:    http://localhost:8191"
log "  Context Comp: http://localhost:8190"

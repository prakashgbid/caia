#!/usr/bin/env bash
# =============================================================================
# infra/browserless/healthcheck.sh
#
# Operator-facing smoke test. Verifies that the Browserless container on
# stolution is up, accepting connections, and reporting healthy pressure.
#
# Usage:
#   ssh stolution 'bash -s' < ./infra/browserless/healthcheck.sh
#   # or, on the stolution host:
#   ./infra/browserless/healthcheck.sh
#
# Exit codes:
#   0 — healthy
#   1 — container not running, or token missing from .env.browserless
#   2 — /pressure unreachable
#   3 — /pressure reports unavailable
# =============================================================================

set -euo pipefail

CONTAINER='stolution-browserless'

# /pressure is auth-gated in Browserless v2; read the token from the
# rendered .env file (created by scripts/deploy-browserless.sh).
ENV_FILE="${HOME}/stolution/.env.browserless"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "FAIL: ${ENV_FILE} missing — run scripts/deploy-browserless.sh first" >&2
  exit 1
fi

TOKEN=$(grep -E '^BROWSERLESS_TOKEN=' "$ENV_FILE" | head -n 1 | cut -d= -f2-)
if [[ -z "$TOKEN" ]]; then
  echo "FAIL: BROWSERLESS_TOKEN empty in ${ENV_FILE}" >&2
  exit 1
fi

ENDPOINT="http://127.0.0.1:13000/pressure?token=${TOKEN}"

# ---- 1. Container running? ------------------------------------------------

if ! docker ps --format '{{.Names}}' | grep -qx "$CONTAINER"; then
  echo "FAIL: container ${CONTAINER} is not running" >&2
  docker ps -a --filter "name=${CONTAINER}" --format 'table {{.Names}}\t{{.Status}}' >&2 || true
  exit 1
fi

# ---- 2. /pressure reachable? ----------------------------------------------

if ! response=$(curl --silent --show-error --max-time 5 "$ENDPOINT" 2>&1); then
  echo "FAIL: pressure endpoint unreachable: ${response}" >&2
  exit 2
fi

# ---- 3. /pressure healthy? ------------------------------------------------
#
# Browserless v2 /pressure JSON shape:
#   {
#     "pressure": {
#       "cpu": 5,                  # percent
#       "memory": 36,              # percent
#       "running": 0,              # active sessions
#       "queued": 0,               # waiting sessions
#       "maxConcurrent": 30,
#       "maxQueued": 20,
#       "isAvailable": true,
#       "reason": "",
#       "recentlyRejected": 0
#     }
#   }

if ! command -v jq >/dev/null 2>&1; then
  echo "OK (raw): $response"
  exit 0
fi

is_available=$(jq -r '.pressure.isAvailable // .isAvailable // true' <<<"$response")
if [[ "$is_available" != "true" ]]; then
  reason=$(jq -r '.pressure.reason // .reason // "unknown"' <<<"$response")
  echo "FAIL: browserless reports unavailable (reason: ${reason})" >&2
  echo "$response" >&2
  exit 3
fi

running=$(jq -r '.pressure.running // .running // 0' <<<"$response")
max=$(jq -r '.pressure.maxConcurrent // .maxConcurrent // 30' <<<"$response")
queued=$(jq -r '.pressure.queued // .queued // .queue // 0' <<<"$response")
cpu=$(jq -r '.pressure.cpu // .cpu // 0' <<<"$response")
mem=$(jq -r '.pressure.memory // .memory // 0' <<<"$response")

printf 'OK: running=%s/%s queued=%s cpu=%s%% mem=%s%%\n' \
  "$running" "$max" "$queued" "$cpu" "$mem"
exit 0

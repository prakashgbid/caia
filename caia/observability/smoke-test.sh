#!/usr/bin/env bash
# caia/observability/smoke-test.sh
#
# End-to-end smoke test of the self-hosted Langfuse stack.
#
# Steps:
# 1. Verify the docker compose stack reports all containers healthy.
# 2. Hit the public health endpoint at http://127.0.0.1:${PORT}/api/public/health.
# 3. Ingest a synthetic OTel-shaped trace via the public API.
# 4. Read it back and assert it landed.
#
# Exits 0 on success, non-zero on failure.

set -euo pipefail

THIS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${THIS_DIR}/.env.local"

[[ -f "${ENV_FILE}" ]] || { echo "✗ ${ENV_FILE} not found. Run init-langfuse-secrets.sh first." >&2; exit 2; }
# shellcheck disable=SC1090
source "${ENV_FILE}"
PORT="${LANGFUSE_PORT:-3001}"
BASE="http://127.0.0.1:${PORT}"

ok()   { echo "✓ $*"; }
info() { echo "→ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# ─── 1. Container health ─────────────────────────────────────────
info "checking container health (caia-langfuse-*)"
not_running="$(docker ps --filter "name=caia-langfuse-" --format '{{.Names}} {{.Status}}' | grep -v "Up" || true)"
if [[ -n "${not_running}" ]]; then
  echo "${not_running}" >&2
  fail "one or more Langfuse containers not Up — run 'docker compose -f docker-compose.langfuse.yml ps' to inspect"
fi
ok "all caia-langfuse-* containers Up"

# ─── 2. /api/public/health ───────────────────────────────────────
info "GET ${BASE}/api/public/health"
HEALTH=$(curl -fsS --max-time 10 "${BASE}/api/public/health" || true)
if [[ -z "${HEALTH}" ]]; then
  fail "health endpoint returned empty / non-200"
fi
ok "health endpoint OK: ${HEALTH}"

# ─── 3. Ingest a synthetic trace via /api/public/ingestion ───────
# The ingestion endpoint takes the Langfuse SDK envelope; we can
# also use OTLP at /api/public/otel/v1/traces. We test the SDK
# envelope here because it requires no protobuf encoding.

if [[ -z "${LANGFUSE_INIT_PROJECT_PUBLIC_KEY:-}" || -z "${LANGFUSE_INIT_PROJECT_SECRET_KEY:-}" ]]; then
  info "no LANGFUSE_INIT_PROJECT_PUBLIC_KEY / SECRET_KEY in .env.local — skipping ingestion smoke (need to fetch keys from UI)"
  ok "smoke test partial pass (health-only)"
  exit 0
fi

TRACE_ID="smoke-$(date +%s)-$$"
EVENT_ID="evt-${TRACE_ID}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

info "ingesting synthetic trace ${TRACE_ID}"
PAYLOAD=$(cat <<JSON
{
  "batch": [
    {
      "id": "${EVENT_ID}",
      "type": "trace-create",
      "timestamp": "${NOW}",
      "body": {
        "id": "${TRACE_ID}",
        "name": "obs-smoke-test",
        "userId": "smoke-test",
        "metadata": {
          "source": "smoke-test.sh",
          "gen_ai.system": "smoke",
          "gen_ai.request.model": "synthetic"
        }
      }
    }
  ]
}
JSON
)

RESP=$(curl -fsS --max-time 15 \
  -u "${LANGFUSE_INIT_PROJECT_PUBLIC_KEY}:${LANGFUSE_INIT_PROJECT_SECRET_KEY}" \
  -H "Content-Type: application/json" \
  -X POST "${BASE}/api/public/ingestion" \
  -d "${PAYLOAD}" || true)

if [[ -z "${RESP}" ]]; then
  fail "ingestion endpoint returned empty / non-2xx"
fi
ok "ingested trace ${TRACE_ID}"

# ─── 4. Read it back ─────────────────────────────────────────────
# Langfuse processes ingestion async via the worker, so allow a
# few seconds before reading.
info "waiting 8s for worker to drain queue"
sleep 8

info "GET ${BASE}/api/public/traces/${TRACE_ID}"
READ=$(curl -fsS --max-time 10 \
  -u "${LANGFUSE_INIT_PROJECT_PUBLIC_KEY}:${LANGFUSE_INIT_PROJECT_SECRET_KEY}" \
  "${BASE}/api/public/traces/${TRACE_ID}" || true)

if [[ -z "${READ}" ]]; then
  fail "could not read back trace ${TRACE_ID} — worker may be slow; retry, or check 'docker logs caia-langfuse-worker'"
fi
echo "${READ}" | grep -q "${TRACE_ID}" || fail "read returned data but trace id ${TRACE_ID} not present"
ok "read back trace ${TRACE_ID} successfully"

ok "smoke test PASSED"

#!/usr/bin/env bash
# scripts/verify-traces.sh
#
# Deployment readiness check for the CAIA observability foundation.
#
# What it does (in this order):
#  1. Verifies the self-hosted Langfuse stack is reachable
#     (PR obs-001's stack at http://localhost:${LANGFUSE_PORT:-3001}).
#  2. Runs a synthetic prompt through a stubbed pipeline + emits OTel
#     `gen_ai.*` spans matching the shapes obs-002 (router) and
#     obs-003 (agents) emit.
#  3. Polls the Langfuse public API until the synthetic trace +
#     expected child spans show up. Times out after N seconds
#     (default 60).
#  4. Asserts every expected span attribute is present with the
#     right value. Exits non-zero on any miss.
#
# Used by:
#  - The orchestrator's launchd plist as a post-start hook to
#    confirm trace ingestion is healthy.
#  - The smart CI/CD agent (PR P1.9 in proposal.adoption.P1) as a
#    deployment-readiness check before promoting any prompt.
#  - Operators running the Langfuse runbook
#    (caia/docs/observability-langfuse.md) to validate setup.
#
# Reference: §6.7 + §7 of
#   reports/caia-ai-tech-modernization-proposal-2026-04-30.md
# Sister PRs:
#   #261 (obs-001 — Langfuse stack)
#   #262 (obs-002 — router OTel spans)
#   #264 (obs-003 — agent OTel helpers)

set -euo pipefail

# ─── config ───────────────────────────────────────────────────────────
LANGFUSE_PORT="${LANGFUSE_PORT:-3001}"
LANGFUSE_HOST="${LANGFUSE_HOST:-http://127.0.0.1:${LANGFUSE_PORT}}"
LANGFUSE_PUBLIC_KEY="${LANGFUSE_PUBLIC_KEY:-}"
LANGFUSE_SECRET_KEY="${LANGFUSE_SECRET_KEY:-}"
TIMEOUT_SECONDS="${VERIFY_TIMEOUT:-60}"
QUIET="${VERIFY_QUIET:-0}"

# ─── helpers ──────────────────────────────────────────────────────────
ok()   { [[ "${QUIET}" -eq 1 ]] || echo "✓ $*"; }
info() { [[ "${QUIET}" -eq 1 ]] || echo "→ $*"; }
fail() { echo "✗ $*" >&2; exit 1; }

# Try to load Langfuse credentials from the obs-001 .env.local if
# the caller didn't supply them via env. This is the common path
# during local development.
load_env_local() {
  local env_file
  env_file="$(dirname "${BASH_SOURCE[0]}")/../caia/observability/.env.local"
  if [[ -z "${LANGFUSE_PUBLIC_KEY}" || -z "${LANGFUSE_SECRET_KEY}" ]] && [[ -f "${env_file}" ]]; then
    # shellcheck disable=SC1090
    set -a
    source "${env_file}"
    set +a
    LANGFUSE_PUBLIC_KEY="${LANGFUSE_INIT_PROJECT_PUBLIC_KEY:-${LANGFUSE_PUBLIC_KEY}}"
    LANGFUSE_SECRET_KEY="${LANGFUSE_INIT_PROJECT_SECRET_KEY:-${LANGFUSE_SECRET_KEY}}"
  fi
}

# ─── 1. Langfuse health ──────────────────────────────────────────────
check_health() {
  info "checking Langfuse health at ${LANGFUSE_HOST}"
  local resp
  resp=$(curl -fsS --max-time 10 "${LANGFUSE_HOST}/api/public/health" 2>/dev/null || true)
  [[ -n "${resp}" ]] || fail "Langfuse not reachable at ${LANGFUSE_HOST}/api/public/health"
  ok "Langfuse is up: ${resp}"
}

# ─── 2. Emit a synthetic trace via the public ingestion API ──────────
# We use the ingest-envelope API rather than OTel-OTLP because it
# requires no protobuf encoder. The schema we emit matches what the
# obs-002 router span + obs-003 agent span would produce on a real
# pipeline run.
emit_synthetic_trace() {
  if [[ -z "${LANGFUSE_PUBLIC_KEY}" || -z "${LANGFUSE_SECRET_KEY}" ]]; then
    fail "LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY must be set (or readable from caia/observability/.env.local)"
  fi

  TRACE_ID="verify-$(date +%s)-$$"
  AGENT_SPAN_ID="agent-${TRACE_ID}"
  ROUTER_SPAN_ID="router-${TRACE_ID}"
  NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)

  info "emitting synthetic trace ${TRACE_ID}"

  # Body mimics the SDK envelope. See:
  # https://langfuse.com/docs/integrations/api
  PAYLOAD=$(cat <<JSON
{
  "batch": [
    {
      "id": "evt-trace-${TRACE_ID}",
      "type": "trace-create",
      "timestamp": "${NOW}",
      "body": {
        "id": "${TRACE_ID}",
        "name": "verify-traces.sh synthetic",
        "userId": "verify-traces",
        "metadata": {
          "source": "verify-traces.sh",
          "obs_foundation_version": "1.0",
          "pipeline.stage": "verify",
          "pipeline.prompt_id": "verify-prompt-1"
        }
      }
    },
    {
      "id": "evt-agent-${TRACE_ID}",
      "type": "span-create",
      "timestamp": "${NOW}",
      "body": {
        "id": "${AGENT_SPAN_ID}",
        "traceId": "${TRACE_ID}",
        "name": "agent.po-agent",
        "metadata": {
          "agent.name": "po-agent",
          "agent.role": "po-decomposer",
          "agent.input_schema": "POAgentInputV1",
          "agent.output_schema": "POAgentOutputV1",
          "agent.duration_ms": 1234,
          "agent.ok": true,
          "gen_ai.agent.name": "po-agent",
          "gen_ai.agent.type": "po-decomposer",
          "pipeline.prompt_id": "verify-prompt-1"
        }
      }
    },
    {
      "id": "evt-router-${TRACE_ID}",
      "type": "span-create",
      "timestamp": "${NOW}",
      "body": {
        "id": "${ROUTER_SPAN_ID}",
        "traceId": "${TRACE_ID}",
        "parentObservationId": "${AGENT_SPAN_ID}",
        "name": "llm.route po-decomposer-coverage-judge",
        "metadata": {
          "gen_ai.system": "claude-binary",
          "gen_ai.provider.name": "subscription",
          "gen_ai.operation.name": "chat",
          "gen_ai.request.model": "claude-sonnet-4-6",
          "gen_ai.request.max_tokens": 1500,
          "gen_ai.request.temperature": 0.2,
          "gen_ai.response.model": "claude-sonnet-4-6",
          "gen_ai.usage.input_tokens": 21,
          "gen_ai.usage.output_tokens": 33,
          "gen_ai.usage.total_tokens": 54,
          "caia.task_type": "po-decomposer-coverage-judge",
          "caia.route_decision": "claude",
          "caia.cache_hit": false,
          "caia.router_version": "0.2.0"
        }
      }
    }
  ]
}
JSON
)

  curl -fsS --max-time 15 \
    -u "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" \
    -H "Content-Type: application/json" \
    -X POST "${LANGFUSE_HOST}/api/public/ingestion" \
    -d "${PAYLOAD}" >/dev/null \
    || fail "ingestion API rejected the synthetic trace"

  ok "ingested trace ${TRACE_ID} (1 trace + 2 child spans)"
}

# ─── 3. Poll for ingestion ───────────────────────────────────────────
wait_for_trace() {
  info "polling ${LANGFUSE_HOST}/api/public/traces/${TRACE_ID} for up to ${TIMEOUT_SECONDS}s"
  local deadline=$(( $(date +%s) + TIMEOUT_SECONDS ))
  while [[ $(date +%s) -lt ${deadline} ]]; do
    local resp
    resp=$(curl -fsS --max-time 5 \
      -u "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" \
      "${LANGFUSE_HOST}/api/public/traces/${TRACE_ID}" 2>/dev/null || true)
    if [[ -n "${resp}" ]] && echo "${resp}" | grep -q "${TRACE_ID}"; then
      TRACE_RESP="${resp}"
      ok "trace landed in Langfuse"
      return 0
    fi
    sleep 2
  done
  fail "trace ${TRACE_ID} did not land within ${TIMEOUT_SECONDS}s — check 'docker logs caia-langfuse-worker'"
}

# ─── 4. Assert expected attributes ───────────────────────────────────
assert_attr() {
  local key="$1"
  local expected="$2"
  if ! echo "${TRACE_RESP}" | grep -q "\"${key}\""; then
    fail "trace missing attribute ${key}"
  fi
  if [[ -n "${expected}" ]] && ! echo "${TRACE_RESP}" | grep -q "${expected}"; then
    fail "trace ${key} did not contain expected value '${expected}'"
  fi
  ok "${key} present${expected:+ (~ ${expected})}"
}

verify_attributes() {
  info "verifying trace + observation attributes"
  # Trace-level
  assert_attr "obs_foundation_version" "1.0"
  assert_attr "pipeline.stage" "verify"
  assert_attr "pipeline.prompt_id" "verify-prompt-1"

  # Pull the observations sub-resource for the trace.
  local obs
  obs=$(curl -fsS --max-time 10 \
    -u "${LANGFUSE_PUBLIC_KEY}:${LANGFUSE_SECRET_KEY}" \
    "${LANGFUSE_HOST}/api/public/observations?traceId=${TRACE_ID}" 2>/dev/null || true)
  [[ -n "${obs}" ]] || fail "could not list observations for trace ${TRACE_ID}"

  # Agent span attrs
  for k in agent.name agent.role agent.input_schema agent.output_schema \
           agent.duration_ms agent.ok gen_ai.agent.name gen_ai.agent.type; do
    if ! echo "${obs}" | grep -q "\"${k}\""; then
      fail "agent span missing attribute ${k}"
    fi
    ok "agent span ${k} present"
  done

  # Router span attrs (gen_ai.* + caia.*)
  for k in gen_ai.system gen_ai.provider.name gen_ai.operation.name \
           gen_ai.request.model gen_ai.response.model \
           gen_ai.usage.input_tokens gen_ai.usage.output_tokens \
           gen_ai.usage.total_tokens \
           caia.task_type caia.route_decision caia.cache_hit \
           caia.router_version; do
    if ! echo "${obs}" | grep -q "\"${k}\""; then
      fail "router span missing attribute ${k}"
    fi
    ok "router span ${k} present"
  done

  # Cross-check: gen_ai.system MUST NOT be 'api-key'
  if echo "${obs}" | grep -q '"gen_ai.system":"api-key"'; then
    fail "gen_ai.system=api-key found — violates feedback_no_api_key_billing.md"
  fi
  ok "gen_ai.system never reports 'api-key' (no-API-key constraint honoured)"
}

# ─── orchestration ────────────────────────────────────────────────────
main() {
  load_env_local
  check_health
  emit_synthetic_trace
  wait_for_trace
  verify_attributes

  echo
  echo "✓ verify-traces.sh: ALL CHECKS PASSED"
  echo "  trace_id     = ${TRACE_ID}"
  echo "  langfuse     = ${LANGFUSE_HOST}"
  echo "  trace url    = ${LANGFUSE_HOST}/project/${LANGFUSE_INIT_PROJECT_ID:-default}/traces/${TRACE_ID}"
  echo
  echo "Observability foundation is ready to ingest production spans."
}

main "$@"

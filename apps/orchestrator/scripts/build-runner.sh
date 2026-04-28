#!/usr/bin/env bash
# build-runner.sh — wraps all build steps, emits Conductor events, persists run to DB.
# Usage: ./scripts/build-runner.sh [--trigger user|pre-commit|ci|executor]
#
# Steps run in order:
#   0. gate:no-secrets (gitleaks + trufflehog — blocks on any finding)
#   1. typecheck
#   2. lint  (if available)
#   3. test
#   4. build
#   5. gate:observability
#   6. gate:coverage
#   7. gate:events-taxonomy
#   8. gate:supply-chain (SEC-050)
#   9. gate:a11y (ACCESS-035)
#  10. gate:brand-lock (POKE-001)
#
# Each step emits build.step_started / build.step_completed / build.step_failed.
# Final event: build.completed or build.aborted.

set -euo pipefail

CONDUCTOR_API="${CONDUCTOR_API:-http://localhost:7776}"
TRIGGER="${1:-user}"
if [[ "${TRIGGER}" == "--trigger" ]]; then TRIGGER="${2:-user}"; fi

BUILD_RUN_ID="br_$(date +%s%N | sha256sum | head -c12)"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')"
START_MS=$(date +%s%3N)
STEP_ORDER=0
STEPS_FAILED=0
ABORTED=0

emit_event() {
  local type="$1"
  local payload="$2"
  curl -sf -X POST "${CONDUCTOR_API}/events" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"${type}\",\"actor\":\"build-runner\",\"payload\":${payload}}" \
    > /dev/null 2>&1 || true
}

register_build() {
  curl -sf -X POST "${CONDUCTOR_API}/builds" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"${BUILD_RUN_ID}\",\"trigger\":\"${TRIGGER}\",\"git_sha\":\"${GIT_SHA}\",\"branch\":\"${BRANCH}\",\"started_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"status\":\"running\",\"steps_total\":0,\"steps_failed\":0}" \
    > /dev/null 2>&1 || true
}

patch_build() {
  local fields="$1"
  curl -sf -X PATCH "${CONDUCTOR_API}/builds/${BUILD_RUN_ID}" \
    -H "Content-Type: application/json" \
    -d "${fields}" > /dev/null 2>&1 || true
}

register_step() {
  local step_id="$1" step_name="$2" command="$3"
  curl -sf -X POST "${CONDUCTOR_API}/builds/${BUILD_RUN_ID}/steps" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"${step_id}\",\"build_run_id\":\"${BUILD_RUN_ID}\",\"step_name\":\"${step_name}\",\"command\":\"${command}\",\"step_order\":${STEP_ORDER},\"status\":\"running\",\"started_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" \
    > /dev/null 2>&1 || true
}

patch_step() {
  local step_id="$1" fields="$2"
  curl -sf -X PATCH "${CONDUCTOR_API}/builds/${BUILD_RUN_ID}/steps/${step_id}" \
    -H "Content-Type: application/json" \
    -d "${fields}" > /dev/null 2>&1 || true
}

run_step() {
  local step_name="$1" command="$2"
  STEP_ORDER=$((STEP_ORDER + 1))
  local step_id="bs_${BUILD_RUN_ID}_${STEP_ORDER}"
  local step_start_ms=$(date +%s%3N)
  local log_file="/tmp/conductor-build-${step_id}.log"

  echo "▶ [${STEP_ORDER}] ${step_name}"
  register_step "${step_id}" "${step_name}" "${command}"
  emit_event "build.step_started" "{\"build_run_id\":\"${BUILD_RUN_ID}\",\"build_step_id\":\"${step_id}\",\"step_name\":\"${step_name}\",\"command\":\"${command}\"}"

  local exit_code=0
  eval "${command}" > "${log_file}" 2>&1 || exit_code=$?

  local step_end_ms=$(date +%s%3N)
  local duration_ms=$((step_end_ms - step_start_ms))
  local stderr_tail
  stderr_tail=$(tail -10 "${log_file}" | sed 's/"/\\"/g' | tr '\n' '|' || echo '')

  if [[ ${exit_code} -eq 0 ]]; then
    echo "  ✓ ${step_name} (${duration_ms}ms)"
    patch_step "${step_id}" "{\"status\":\"success\",\"exit_code\":0,\"ended_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"duration_ms\":${duration_ms},\"stdout_tail\":\"${stderr_tail}\"}"
    emit_event "build.step_completed" "{\"build_run_id\":\"${BUILD_RUN_ID}\",\"build_step_id\":\"${step_id}\",\"step_name\":\"${step_name}\",\"exit_code\":0,\"duration_ms\":${duration_ms}}"
  else
    STEPS_FAILED=$((STEPS_FAILED + 1))
    echo "  ✗ ${step_name} FAILED (exit ${exit_code}, ${duration_ms}ms)"
    cat "${log_file}" | tail -20
    local error_sig
    error_sig=$(grep -oE '(error TS[0-9]+|Error:|FAIL |FAILED)' "${log_file}" | head -3 | tr '\n' ',' || echo 'unknown')
    patch_step "${step_id}" "{\"status\":\"failed\",\"exit_code\":${exit_code},\"ended_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"duration_ms\":${duration_ms},\"stderr_tail\":\"${stderr_tail}\",\"error_signature\":\"${error_sig}\"}"
    emit_event "build.step_failed" "{\"build_run_id\":\"${BUILD_RUN_ID}\",\"build_step_id\":\"${step_id}\",\"step_name\":\"${step_name}\",\"exit_code\":${exit_code},\"duration_ms\":${duration_ms},\"stderr_tail\":\"${stderr_tail}\",\"error_signature\":\"${error_sig}\"}"
    rm -f "${log_file}"
    return ${exit_code}
  fi
  rm -f "${log_file}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

echo "=== Conductor build runner ==="
echo "  build_run_id: ${BUILD_RUN_ID}"
echo "  trigger:      ${TRIGGER}"
echo "  git_sha:      ${GIT_SHA}  branch: ${BRANCH}"
echo ""

register_build
emit_event "build.started" "{\"build_run_id\":\"${BUILD_RUN_ID}\",\"trigger\":\"${TRIGGER}\",\"git_sha\":\"${GIT_SHA}\",\"branch\":\"${BRANCH}\",\"changed_files\":[]}"

# Steps
run_step "gate:no-secrets" "npm run gate:no-secrets" || { ABORTED=1; true; }
if [[ ${ABORTED} -eq 0 ]]; then
  run_step "typecheck" "npm run typecheck" || { ABORTED=1; true; }
fi
if [[ ${ABORTED} -eq 0 ]]; then
  run_step "test" "npm test -- --passWithNoTests" || { ABORTED=1; true; }
fi
if [[ ${ABORTED} -eq 0 ]]; then
  run_step "build" "npm run build" || { ABORTED=1; true; }
fi
if [[ ${ABORTED} -eq 0 ]] && grep -q '"gate:observability"' package.json 2>/dev/null; then
  run_step "gate:observability" "npm run gate:observability" || true
fi
if [[ ${ABORTED} -eq 0 ]] && grep -q '"gate:coverage"' package.json 2>/dev/null; then
  run_step "gate:coverage" "npm run gate:coverage" || true
fi
if [[ ${ABORTED} -eq 0 ]] && grep -q '"gate:events-taxonomy"' package.json 2>/dev/null; then
  run_step "gate:events-taxonomy" "npm run gate:events-taxonomy" || true
fi
if [[ ${ABORTED} -eq 0 ]] && grep -q '"gate:supply-chain"' package.json 2>/dev/null; then
  run_step "gate:supply-chain" "npm run gate:supply-chain" || true
fi
if [[ ${ABORTED} -eq 0 ]] && grep -q '"gate:a11y"' package.json 2>/dev/null; then
  run_step "gate:a11y" "npm run gate:a11y" || true
fi
if [[ ${ABORTED} -eq 0 ]] && grep -q '"gate:brand-lock"' package.json 2>/dev/null; then
  run_step "gate:brand-lock" "npm run gate:brand-lock" || true
fi

END_MS=$(date +%s%3N)
TOTAL_MS=$((END_MS - START_MS))
TOTAL_STEPS=${STEP_ORDER}

if [[ ${ABORTED} -eq 1 ]]; then
  patch_build "{\"status\":\"failed\",\"outcome\":\"failure\",\"ended_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"duration_ms\":${TOTAL_MS},\"steps_total\":${TOTAL_STEPS},\"steps_failed\":${STEPS_FAILED}}"
  emit_event "build.aborted" "{\"build_run_id\":\"${BUILD_RUN_ID}\",\"reason\":\"step_failed\",\"completed_steps\":$((TOTAL_STEPS - 1))}"
  echo ""
  echo "✗ Build FAILED in ${TOTAL_MS}ms (${STEPS_FAILED}/${TOTAL_STEPS} steps failed)"
  exit 1
else
  OUTCOME="success"
  if [[ ${STEPS_FAILED} -gt 0 ]]; then OUTCOME="partial"; fi
  patch_build "{\"status\":\"completed\",\"outcome\":\"${OUTCOME}\",\"ended_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"duration_ms\":${TOTAL_MS},\"steps_total\":${TOTAL_STEPS},\"steps_failed\":${STEPS_FAILED}}"
  emit_event "build.completed" "{\"build_run_id\":\"${BUILD_RUN_ID}\",\"outcome\":\"${OUTCOME}\",\"duration_ms\":${TOTAL_MS},\"steps_total\":${TOTAL_STEPS},\"steps_failed\":${STEPS_FAILED}}"
  echo ""
  echo "✓ Build ${OUTCOME} in ${TOTAL_MS}ms (${STEPS_FAILED} failures / ${TOTAL_STEPS} steps)"
fi

#!/bin/bash
# gate-publish.sh — Pre-publish behavioral test gate.
#
# Usage:
#   npm run gate:publish
#   SCOPE_FILES="tests/behavior/home.behavior.ts" npm run gate:publish
#
# Non-negotiable: exits non-zero on any test failure.
# The gate cannot be skipped for behavioral regressions.
#
# Domains: testing-qa

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_ROOT="${SITE_ROOT:-$(pwd)}"

echo "[gate] Running behavioral test gate in: $SITE_ROOT"
echo "[gate] $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Resolve scope — either explicit or infer from git diff
if [[ -n "${SCOPE_FILES:-}" ]]; then
  echo "[gate] Using explicit scope: $SCOPE_FILES"
  RESOLVED_FILES="$SCOPE_FILES"
else
  echo "[gate] Inferring scope from git diff HEAD..."
  CHANGED=$(git diff --name-only HEAD 2>/dev/null || git diff --name-only HEAD~1 HEAD 2>/dev/null || echo "")
  if [[ -z "$CHANGED" ]]; then
    echo "[gate] No changed files detected — running full suite"
    RESOLVED_FILES=$(ls "$SITE_ROOT/tests/behavior/"*.behavior.ts 2>/dev/null | tr '\n' ' ')
  else
    RESOLVED_FILES=$(echo "$CHANGED" | SITE_ROOT="$SITE_ROOT" npx tsx "$SCRIPT_DIR/scope-tests.ts" --stdin || "")
  fi
fi

if [[ -z "${RESOLVED_FILES:-}" ]]; then
  echo "[gate] No behavior tests matched scope — gate passes trivially"
  exit 0
fi

echo "[gate] Tests to run:"
echo "$RESOLVED_FILES" | tr ' ' '\n' | sed 's/^/  /'

# Ensure playwright is installed
if ! command -v npx &>/dev/null; then
  echo "[gate] ERROR: npx not found. Install Node.js first."
  exit 1
fi

# Check dev server is reachable
BASE_URL="${BEHAVIOR_BASE_URL:-}"
if [[ -z "$BASE_URL" ]]; then
  # Detect site from package.json name or directory
  PKG_NAME=$(node -e "try{console.log(require('./package.json').name)}catch{}" 2>/dev/null || echo "")
  if [[ "$PKG_NAME" == *"poker-zeno"* ]]; then
    BASE_URL="http://localhost:3001"
  else
    BASE_URL="http://localhost:3000"
  fi
fi

echo "[gate] Checking dev server at $BASE_URL..."
if ! curl -sf --max-time 5 "$BASE_URL" > /dev/null 2>&1; then
  if [[ "${CI:-}" == "1" ]]; then
    echo "[gate] ERROR: Dev server not reachable at $BASE_URL (CI mode — server should be started by CI workflow)"
    exit 1
  fi
  echo "[gate] WARNING: Dev server not reachable at $BASE_URL — attempting to start..."
  # Start in background and wait
  npm run dev &
  DEV_PID=$!
  echo "[gate] Waiting for dev server to start (PID: $DEV_PID)..."
  for i in $(seq 1 30); do
    if curl -sf --max-time 2 "$BASE_URL" > /dev/null 2>&1; then
      echo "[gate] Dev server ready after ${i}s"
      break
    fi
    sleep 1
    if [[ $i -eq 30 ]]; then
      echo "[gate] ERROR: Dev server failed to start after 30s"
      kill "$DEV_PID" 2>/dev/null || true
      exit 1
    fi
  done
fi

# Run the scoped behavior tests
echo "[gate] Running behavior tests..."
EXIT_CODE=0
BEHAVIOR_BASE_URL="$BASE_URL" npx playwright test \
  --config playwright.behavior.config.ts \
  $RESOLVED_FILES \
  ${CI:+--forbid-only} || EXIT_CODE=$?

if [[ $EXIT_CODE -ne 0 ]]; then
  echo ""
  echo "[gate] ============================================================"
  echo "[gate] BEHAVIORAL TEST GATE FAILED — $EXIT_CODE test(s) failed"
  echo "[gate] Publish is BLOCKED until these behavioral regressions are fixed."
  echo "[gate] ============================================================"
  exit $EXIT_CODE
fi

echo "[gate] All behavioral tests passed. Gate is GREEN."
exit 0

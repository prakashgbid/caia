#!/usr/bin/env bash
# apps/dashboard/scripts/run-live-smoke.sh
#
# Runs the live-cluster wizard smoke against a deployed dashboard.
#
# Two auth modes (pick ONE; the spec asserts at boot):
#
#   1. storageState (preferred for local-operator runs):
#        Capture once:
#          pnpm --filter @caia-app/dashboard exec \
#            tsx tests/e2e/setup-cloudflare-access.ts --capture
#        Then export:
#          export PLAYWRIGHT_STORAGE_STATE=./tests/e2e/.auth/live-state.json
#
#   2. service-token (preferred for CI):
#        export CF_ACCESS_CLIENT_ID=<id>
#        export CF_ACCESS_CLIENT_SECRET=<secret>
#
# Optional knobs:
#   LIVE_DASHBOARD_URL       — default https://dashboard.chiefaia.com
#   LIVE_SMOKE_EMAIL         — default prakash.stolution@gmail.com
#   LIVE_SMOKE_DATABASE_URL  — direct pg conn for FSM assertions (e.g. via
#                              `kubectl port-forward svc/chiefaia-postgres
#                               5432:5432`). When unset, the smoke skips
#                              Postgres assertions and just walks the UI.
#   LIVE_SMOKE_TEMPO_URL     — Tempo HTTP base for trace assertions (e.g.
#                              http://localhost:3200 via port-forward).
#                              When unset, trace assertions are skipped.
#   LIVE_SMOKE_IGNORE_TLS    — set to 1 to bypass TLS verification (staging
#                              with self-signed certs).
#
# Operator runbook: apps/dashboard/SMOKE_RUNBOOK.md
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DASHBOARD_DIR="$(cd "${DIR}/.." && pwd)"

cd "${DASHBOARD_DIR}"

echo "[run-live-smoke] dashboard=${LIVE_DASHBOARD_URL:-https://dashboard.chiefaia.com}"
echo "[run-live-smoke] email=${LIVE_SMOKE_EMAIL:-prakash.stolution@gmail.com}"

# Auth-mode sanity check — duplicate of the spec's, but failing here
# saves a Playwright cold-start when the operator forgot to export.
if [[ -z "${PLAYWRIGHT_STORAGE_STATE:-}" ]] \
   && { [[ -z "${CF_ACCESS_CLIENT_ID:-}" ]] || [[ -z "${CF_ACCESS_CLIENT_SECRET:-}" ]]; }; then
  echo "[run-live-smoke] ERROR: no CF Access auth mode configured." >&2
  echo "  set PLAYWRIGHT_STORAGE_STATE=<path> OR CF_ACCESS_CLIENT_ID + CF_ACCESS_CLIENT_SECRET" >&2
  exit 2
fi

if [[ -n "${PLAYWRIGHT_STORAGE_STATE:-}" ]]; then
  echo "[run-live-smoke] auth-mode=storageState ($PLAYWRIGHT_STORAGE_STATE)"
  if [[ ! -f "${PLAYWRIGHT_STORAGE_STATE}" ]]; then
    echo "[run-live-smoke] ERROR: storage state file not found at ${PLAYWRIGHT_STORAGE_STATE}" >&2
    echo "  Run: pnpm --filter @caia-app/dashboard exec tsx tests/e2e/setup-cloudflare-access.ts --capture" >&2
    exit 3
  fi
else
  echo "[run-live-smoke] auth-mode=service-token"
fi

# Install browsers if not already present. Idempotent — skipped if cached.
pnpm exec playwright install --with-deps chromium >/dev/null 2>&1 || true

# Run with the dedicated live-smoke config. We forward any extra args so
# the operator can pass `--debug`, `--ui`, `--headed`, etc.
pnpm exec playwright test \
  --config=playwright.live-smoke.config.ts \
  "$@"

RC=$?
echo "[run-live-smoke] playwright exit=$RC"
echo "[run-live-smoke] HTML report: ${DASHBOARD_DIR}/playwright-report-live-smoke/index.html"
echo "[run-live-smoke] JSON report: ${DASHBOARD_DIR}/playwright-report-live-smoke/results.json"
exit $RC

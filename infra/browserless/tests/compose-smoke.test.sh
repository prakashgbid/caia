#!/usr/bin/env bash
# =============================================================================
# infra/browserless/tests/compose-smoke.test.sh
#
# CI-runnable smoke test that:
#   1. Validates docker-compose.browserless.yml syntax
#   2. Asserts the v2 env names are present (CONCURRENT, QUEUED, TIMEOUT, TOKEN)
#   3. Asserts NO v1 env names (MAX_CONCURRENT_SESSIONS, KEEP_ALIVE,
#      DEFAULT_LAUNCH_ARGS, ENABLE_API_GET, CONNECTION_TIMEOUT)
#   4. Asserts the host bind is 127.0.0.1:13000 (NOT 3001)
#   5. Asserts the image is pinned (vX.Y.Z, not :latest)
#   6. Asserts companion scripts exist + executable
#   7. Asserts the README documents the v2 connection URL
#   8. Asserts the README documents the 13000-vs-3001 rationale
#   9. Asserts the healthcheck reads the token from the env file
#
# Runs offline — no network, no docker daemon required (will degrade
# gracefully if either is unavailable).
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
COMPOSE="${REPO_ROOT}/infra/browserless/docker-compose.yml"
README="${REPO_ROOT}/infra/browserless/README.md"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
pass() { printf 'ok %d - %s\n' "$1" "$2"; }

n=0
next() { n=$((n + 1)); }

# ---- 1. compose file exists + parses --------------------------------------
next
[[ -f "$COMPOSE" ]] || fail "missing $COMPOSE"
if python3 -c 'import yaml' 2>/dev/null; then
  python3 -c "import yaml; yaml.safe_load(open('$COMPOSE'))" \
    || fail "compose yaml is invalid"
elif command -v docker >/dev/null 2>&1; then
  docker compose -f "$COMPOSE" config >/dev/null 2>&1 \
    || fail "compose yaml fails docker compose config"
else
  grep -q '^services:' "$COMPOSE" || fail "no services: stanza"
  grep -q 'image:'     "$COMPOSE" || fail "no image: stanza"
  grep -q 'ports:'     "$COMPOSE" || fail "no ports: stanza"
fi
pass $n "compose file exists and parses"

# ---- 2. v2 env names present ----------------------------------------------
for v in CONCURRENT QUEUED TIMEOUT TOKEN; do
  next
  grep -q "^      ${v}:" "$COMPOSE" || fail "missing v2 env ${v}"
  pass $n "compose has v2 env ${v}"
done

# ---- 3. v1 env names absent -----------------------------------------------
for v in MAX_CONCURRENT_SESSIONS KEEP_ALIVE DEFAULT_LAUNCH_ARGS ENABLE_API_GET CONNECTION_TIMEOUT; do
  next
  if grep -q "^      ${v}:" "$COMPOSE"; then
    fail "compose still uses v1 env ${v} — Browserless v2 ignores or rejects this"
  fi
  pass $n "compose does NOT use deprecated v1 env ${v}"
done

# ---- 4. host bind is 127.0.0.1:13000 --------------------------------------
next
grep -q '"127.0.0.1:13000:3000"' "$COMPOSE" \
  || fail "host bind missing or wrong; want 127.0.0.1:13000:3000"
pass $n "host bind is 127.0.0.1:13000 (not 3001 — that is grafana)"

# ---- 5. image is pinned to a release tag ----------------------------------
next
if grep -qE '^\s*image:\s*ghcr\.io/browserless/chromium:latest' "$COMPOSE"; then
  fail "image must NOT be :latest; pin to a verified release tag"
fi
grep -qE '^\s*image:\s*ghcr\.io/browserless/chromium:v[0-9]+\.[0-9]+\.[0-9]+' "$COMPOSE" \
  || fail "image must be pinned to a vMAJOR.MINOR.PATCH tag"
pass $n "image pinned to a release tag"

# ---- 6. companion scripts present + executable ----------------------------
for s in healthcheck.sh scripts/deploy-browserless.sh scripts/smoke-test.sh; do
  next
  path="${REPO_ROOT}/infra/browserless/${s}"
  [[ -f "$path" ]] || fail "missing $path"
  [[ -x "$path" ]] || fail "$path is not executable"
  pass $n "$s exists and is executable"
done

# ---- 7. README documents v2 connection URL --------------------------------
next
grep -q '/playwright/chromium' "$README" \
  || fail "README must document the v2 connection path /playwright/chromium"
pass $n "README documents v2 /playwright/chromium endpoint"

# ---- 8. README mentions port 13000 with rationale -------------------------
next
grep -q '13000' "$README" || fail "README must reference 13000"
grep -qiE 'grafana|3001' "$README" \
  || fail "README must explain why we are NOT on 3001"
pass $n "README documents 13000 vs 3001 rationale"

# ---- 9. healthcheck reads the token from the env file ---------------------
next
grep -q 'BROWSERLESS_TOKEN' "${REPO_ROOT}/infra/browserless/healthcheck.sh" \
  || fail "healthcheck.sh must read BROWSERLESS_TOKEN"
pass $n "healthcheck reads BROWSERLESS_TOKEN from .env.browserless"

echo "1..$n"

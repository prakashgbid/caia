#!/usr/bin/env bash
# =============================================================================
# infra/browserless/scripts/smoke-test.sh
#
# End-to-end smoke test for stolution-browserless. Connects to the live
# WS endpoint via Playwright, navigates a trivial page, asserts on a
# selector, takes a screenshot, and logs pressure stats.
#
# Connection URL note: Browserless v2 exposes Playwright at
#   ws://host:port/playwright/chromium?token=...
# (NOT the bare host — that is v1).
#
# Requires: node + a node_modules tree containing `playwright`. Pass
# NODE_DIR to point at one. Defaults to a stolution worktree where
# playwright is already installed.
#
# Usage:
#   BROWSERLESS_WS_ENDPOINT=ws://127.0.0.1:13000/playwright/chromium \
#   BROWSERLESS_TOKEN=...                                             \
#   NODE_DIR=/home/s903/stolution-worktrees/cci-17                    \
#     ./infra/browserless/scripts/smoke-test.sh
# =============================================================================

set -euo pipefail

ENDPOINT="${BROWSERLESS_WS_ENDPOINT:-ws://127.0.0.1:13000/playwright/chromium}"
TOKEN="${BROWSERLESS_TOKEN:-}"
NODE_DIR="${NODE_DIR:-/home/s903/stolution-worktrees/cci-17}"

if [[ -z "$TOKEN" ]]; then
  if [[ -f "${HOME}/stolution/.env.browserless" ]]; then
    TOKEN=$(grep -E '^BROWSERLESS_TOKEN=' "${HOME}/stolution/.env.browserless" | head -n 1 | cut -d= -f2-)
  fi
fi

if [[ -z "$TOKEN" ]]; then
  echo "FAIL: BROWSERLESS_TOKEN required (env or ~/stolution/.env.browserless)" >&2
  exit 1
fi

if [[ ! -d "${NODE_DIR}/node_modules/playwright" ]]; then
  echo "FAIL: playwright not found at ${NODE_DIR}/node_modules/playwright" >&2
  exit 1
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

cat > "${WORK}/smoke.cjs" <<'JS'
const { chromium } = require('playwright');
(async () => {
  const url = process.env.BROWSERLESS_WS_ENDPOINT + '?token=' + process.env.BROWSERLESS_TOKEN;
  const browser = await chromium.connect(url, { timeout: 15000 });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setContent('<html><body><h1 id="x">browserless-ok</h1></body></html>');
    const text = await page.textContent('#x');
    if (text !== 'browserless-ok') throw new Error('selector text mismatch: ' + text);
    const buf = await page.screenshot();
    if (buf.byteLength < 100) throw new Error('screenshot suspiciously small');
    console.log('OK: text=' + text + ' bytes=' + buf.byteLength);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
JS

# Copy under NODE_DIR so node can resolve `playwright`.
cp "${WORK}/smoke.cjs" "${NODE_DIR}/.bl-smoke.cjs"
trap 'rm -rf "$WORK"; rm -f "${NODE_DIR}/.bl-smoke.cjs"' EXIT

BROWSERLESS_WS_ENDPOINT="$ENDPOINT" \
BROWSERLESS_TOKEN="$TOKEN" \
  node "${NODE_DIR}/.bl-smoke.cjs"

# Pressure check (post-run; should report 0 active)
echo "--- pressure ---"
curl --silent --max-time 5 "http://127.0.0.1:13000/pressure?token=${TOKEN}" | head -c 600
echo

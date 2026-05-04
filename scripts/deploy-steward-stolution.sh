#!/usr/bin/env bash
# deploy-steward-stolution.sh — Build steward-analyzers + rsync the dist
# bundle to the stolution server, where it runs daily via cron to surface
# failure mode #7 (backup pipeline silent failure) on the side that
# actually writes the snapshots.
#
# Why this exists: the Mac-side `vault-checks` LaunchAgent (shipped in
# PR #298) only sees the Mac-pulled snapshot dir. The stolution-native
# snapshot dir (`/home/s903/backups/vault`) is on the stolution server,
# so the only way to check it without an SSH round-trip every cron tick
# is to run the CLI on stolution itself.
#
# Operator usage:
#   bash scripts/deploy-steward-stolution.sh
#
# Or non-interactive (CI):
#   STOLUTION_HOST=stolution bash scripts/deploy-steward-stolution.sh
#
# After deploy, verify on stolution:
#   ssh stolution "node /home/s903/stolution/tools/steward/bin/steward-gatekeeper.mjs vault-checks --side stolution"
#
# The cron entry is installed once by `scripts/install-stolution-cron.sh`
# (separate one-shot) and then re-applies of this script just refresh
# the bundle without touching cron.
#
# Reference: agent/memory/steward_gatekeeper_directive.md (modes 7, 8, 9),
#            ~/Documents/projects/reports/principal-overnight-shipped-2026-05-04.md.

set -euo pipefail

HOST="${STOLUTION_HOST:-stolution}"
REMOTE_DIR="${REMOTE_DIR:-/home/s903/stolution/tools/steward}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${HERE}/packages/steward-analyzers"

echo "→ build @chiefaia/steward-analyzers"
( cd "${HERE}" && pnpm --filter @chiefaia/steward-analyzers build ) >/dev/null

echo "→ ensure remote dir ${HOST}:${REMOTE_DIR}"
ssh "${HOST}" "mkdir -p ${REMOTE_DIR}/dist ${REMOTE_DIR}/bin"

echo "→ rsync dist + bin"
rsync -a --delete "${PKG}/dist/" "${HOST}:${REMOTE_DIR}/dist/"
rsync -a "${PKG}/bin/steward-gatekeeper.mjs" "${HOST}:${REMOTE_DIR}/bin/steward-gatekeeper.mjs"

# Minimal package.json so node resolves "../dist/index.js" via ESM.
cat > /tmp/steward-stolution-package.json <<'JSON'
{
  "name": "steward-stolution-runtime",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "description": "Stolution-side runtime bundle for @chiefaia/steward-analyzers. Synced by caia/scripts/deploy-steward-stolution.sh. DO NOT edit by hand."
}
JSON
rsync -a /tmp/steward-stolution-package.json "${HOST}:${REMOTE_DIR}/package.json"

echo "→ smoke-test on remote"
ssh "${HOST}" "cd ${REMOTE_DIR} && node bin/steward-gatekeeper.mjs vault-checks --side stolution || true"

echo "✓ deploy complete. Cron entry must be installed separately (one-time):"
echo "   ssh ${HOST} 'crontab -l > /tmp/cron.bak && (crontab -l; echo \"30 17 * * * cd ${REMOTE_DIR} && /usr/bin/node bin/steward-gatekeeper.mjs vault-checks --side stolution >> /home/s903/logs/steward-vault-checks.log 2>&1\") | crontab -'"

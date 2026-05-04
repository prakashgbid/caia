#!/usr/bin/env bash
# install-stolution-cron.sh — One-shot installer for the daily steward
# vault-checks cron entry on the stolution server. Idempotent: detects
# an existing entry by line marker and skips if present.
#
# Reads + writes the s903 user's crontab (no sudo required). Snapshots
# the prior crontab to /tmp/cron.bak.steward-deploy.<unix-ts> before
# any mutation.
#
# Pair with `scripts/deploy-steward-stolution.sh` — that script syncs
# the bundle; this one wires up the cron once. After this runs, future
# bundle updates only need the deploy script.
#
# Usage:
#   bash scripts/install-stolution-cron.sh
#
# Reference: agent/memory/steward_gatekeeper_directive.md (mode 7).

set -euo pipefail

HOST="${STOLUTION_HOST:-stolution}"
REMOTE_DIR="${REMOTE_DIR:-/home/s903/stolution/tools/steward}"
LOG="${LOG:-/home/s903/logs/steward-vault-checks.log}"
# Daily 17:30 UTC ≈ 10:30 PT (summer) / 09:30 PT (winter). Offset 30
# minutes from hygiene-report.yml (17:00 UTC) to avoid runner contention.
SCHEDULE="${SCHEDULE:-30 17 * * *}"

CRON_LINE="${SCHEDULE} cd ${REMOTE_DIR} && /usr/bin/node bin/steward-gatekeeper.mjs vault-checks --side stolution >> ${LOG} 2>&1"

ssh "${HOST}" bash -s <<EOF
set -euo pipefail
mkdir -p "$(dirname "${LOG}")"
touch "${LOG}"
crontab -l > /tmp/cron.bak.steward-deploy.\$(date +%s) 2>&1 || true
if crontab -l 2>/dev/null | grep -Fq 'bin/steward-gatekeeper.mjs vault-checks --side stolution'; then
  echo "→ stolution-side steward cron entry already present; skipping."
  crontab -l | grep -F 'steward-gatekeeper'
  exit 0
fi
( crontab -l 2>/dev/null; echo "${CRON_LINE}" ) | crontab -
echo "✓ installed cron entry:"
crontab -l | grep -F 'steward-gatekeeper'
EOF

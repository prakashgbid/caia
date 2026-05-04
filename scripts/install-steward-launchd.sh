#!/usr/bin/env bash
# install-steward-launchd.sh — Install the Mac-side Steward LaunchAgents.
# Idempotent: unloads any prior version of each plist before re-loading,
# so re-runs pick up plist edits without operator intervention.
#
# Installs:
#   ~/Library/LaunchAgents/com.steward.daily.plist  (09:00 local daily)
#   ~/Library/LaunchAgents/com.steward.weekly.plist (Mondays 09:15 local)
#
# Verify after install:
#   launchctl list | grep com.steward
#   launchctl kickstart -k gui/$UID/com.steward.daily   # fire on demand
#   tail -50 ~/Library/Logs/steward-daily.launchd.log
#
# Reference: agent/memory/steward_gatekeeper_directive.md.

set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="${HERE}/infrastructure/launchd"
DEST_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs"
# launchd-spawned scripts CANNOT execute targets under ~/Documents on
# modern macOS (TCC privacy controls block "Full Disk Access" for the
# launchd worker). Mirror the wrapper into ~/bin/ — the same pattern
# used by ~/bin/pull-stolution-vault-snapshots.sh shipped with the
# vault-snapshot-pull LaunchAgent.
BIN_DIR="${HOME}/bin"

mkdir -p "${DEST_DIR}" "${LOG_DIR}" "${BIN_DIR}"

# Mirror the wrapper to ~/bin/ so launchd can exec it without TCC blocks.
cp "${HERE}/scripts/steward-run.sh" "${BIN_DIR}/steward-run.sh"
chmod +x "${BIN_DIR}/steward-run.sh"
echo "→ mirrored ${BIN_DIR}/steward-run.sh"

for plist in com.steward.daily.plist com.steward.weekly.plist; do
  src="${SRC_DIR}/${plist}"
  dest="${DEST_DIR}/${plist}"
  label="${plist%.plist}"

  if [[ ! -f "${src}" ]]; then
    echo "✗ source plist missing: ${src}" >&2
    exit 1
  fi

  # Unload prior version if loaded (ignore failure — may not be loaded yet).
  if launchctl list 2>/dev/null | grep -q "${label}"; then
    echo "→ unloading existing ${label}"
    launchctl unload "${dest}" 2>/dev/null || true
  fi

  cp "${src}" "${dest}"
  echo "→ installed ${dest}"

  launchctl load "${dest}"
  echo "→ loaded ${label}"
done

echo
echo "✓ All Steward launchd agents installed."
echo
launchctl list | grep -E "com\.steward\.(daily|weekly)" || true
echo
echo "Manual fire (smoke test):"
echo "  launchctl kickstart -k gui/\$UID/com.steward.daily"

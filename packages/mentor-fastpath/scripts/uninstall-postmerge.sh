#!/usr/bin/env bash
#
# Uninstall the Mentor Phase-2 postmerge LaunchAgents.
#
# Usage:
#   ./packages/mentor-fastpath/scripts/uninstall-postmerge.sh
#
# Idempotent: if either agent isn't installed, exits 0.

set -euo pipefail

LA_DIR="${HOME}/Library/LaunchAgents"
WATCHER_LABEL="com.caia.mentor.postmerge-watcher"
CONSUMER_LABEL="com.caia.mentor.postmerge-consumer"

uninstall_one() {
    local label="$1"
    local dst="${LA_DIR}/${label}.plist"
    local domain="gui/$(id -u)"

    if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
        launchctl bootout "${domain}/${label}" || true
        echo "✓ booted out ${label}"
    fi

    if [[ -f "${dst}" ]]; then
        rm -f "${dst}"
        echo "✓ removed ${dst}"
    fi
}

uninstall_one "${WATCHER_LABEL}"
uninstall_one "${CONSUMER_LABEL}"

echo ""
echo "✓ Mentor Phase-2 postmerge uninstall complete."
echo ""
echo "  State DBs left in place (in case you want to re-install):"
echo "    \${CAIA_EVENT_BUS_DB_PATH}.postmerge-watcher-state.sqlite"
echo "    \${CAIA_EVENT_BUS_DB_PATH}.postmerge-consumer-offset.sqlite"
echo "  Delete those manually if you want a clean reinstall."

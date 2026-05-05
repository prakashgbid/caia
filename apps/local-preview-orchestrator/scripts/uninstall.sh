#!/usr/bin/env bash
#
# Bootout + remove all local-preview LaunchAgents.
#
# Does NOT remove build artifacts under
# ~/Library/Application Support/Stolution/local-preview/  — that's destructive
# and should be done by hand if desired.
#
# Usage:
#   ./scripts/uninstall.sh
#   ./scripts/uninstall.sh --purge      # also rm builds/ and incident logs

set -euo pipefail

PURGE=0
for arg in "$@"; do
    case "${arg}" in
        --purge) PURGE=1 ;;
        *) echo "Unknown arg: ${arg}" >&2; exit 2 ;;
    esac
done

LA_DIR="${HOME}/Library/LaunchAgents"
INSTALL_ROOT="${HOME}/Library/Application Support/Stolution/local-preview"

PLIST_LABELS=(
    "com.stolution.local-preview.deploy-daemon"
    "com.stolution.local-preview.status-dashboard"
    "com.stolution.local-preview.dashboard"
    "com.stolution.local-preview.poker-zeno"
    "com.stolution.local-preview.roulette-community"
)

echo "Booting out + removing local-preview agents..."
for label in "${PLIST_LABELS[@]}"; do
    plist="${LA_DIR}/${label}.plist"
    if [[ -f "${plist}" ]]; then
        if launchctl list | grep -q "${label}"; then
            launchctl bootout "gui/$(id -u)" "${plist}" 2>/dev/null || true
            echo "  booted out ${label}"
        fi
        rm -f "${plist}"
        echo "  removed ${label}.plist"
    fi
done

if (( PURGE == 1 )); then
    echo
    echo "Purging install root: ${INSTALL_ROOT}"
    if [[ -d "${INSTALL_ROOT}" ]]; then
        rm -r "${INSTALL_ROOT}"
        echo "  removed ${INSTALL_ROOT}"
    fi
fi

echo
echo "✓ Local-preview agents removed."
if (( PURGE == 0 )); then
    echo "  Build artifacts under ${INSTALL_ROOT}/ are untouched."
    echo "  Re-run with --purge to delete them too."
fi

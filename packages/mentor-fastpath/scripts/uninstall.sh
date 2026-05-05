#!/usr/bin/env bash
#
# Uninstall the Mentor Phase-1 fast-path LaunchAgent.
#
# Usage:
#   ./packages/mentor-fastpath/scripts/uninstall.sh
#       — bootout + remove the plist; PRESERVE proposals/ + offset DB
#   ./packages/mentor-fastpath/scripts/uninstall.sh --purge
#       — also delete the offset DB (events.sqlite.fastpath-offset.sqlite)
#       — does NOT delete proposals/ (those are operator artifacts)
#
# Idempotent: safe to re-run.

set -euo pipefail

PURGE=0
if [[ "${1:-}" == "--purge" ]]; then
    PURGE=1
fi

LA_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/caia-mentor"
DB_DIR="${HOME}/Library/Application Support/caia/events"
DB_PATH="${CAIA_EVENT_BUS_DB_PATH:-${DB_DIR}/events.sqlite}"
OFFSET_DB="${DB_PATH}.fastpath-offset.sqlite"

PLIST_LABEL="com.caia.mentor.fastpath"

if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: uninstall.sh runs on macOS only." >&2
    exit 2
fi

# Bootout + remove the plist.
dst="${LA_DIR}/${PLIST_LABEL}.plist"
if launchctl list | grep -q "${PLIST_LABEL}"; then
    launchctl bootout "gui/$(id -u)" "${dst}" 2>/dev/null || true
    echo "  booted out ${PLIST_LABEL}"
fi
if [[ -f "${dst}" ]]; then
    rm -f "${dst}"
    echo "  removed ${dst}"
fi

if (( PURGE == 1 )); then
    if [[ -f "${OFFSET_DB}" ]]; then
        rm -f "${OFFSET_DB}" "${OFFSET_DB}-wal" "${OFFSET_DB}-shm"
        echo "  purged ${OFFSET_DB} (+ WAL/SHM)"
    fi
else
    echo "  preserved ${OFFSET_DB} (use --purge to delete)"
fi

# Always preserve proposals — those are operator artifacts, not infra state.
echo "  preserved <CAIA_MEMORY_DIR>/proposals/ (intentional — operator review queue)"

echo
echo "✓ Mentor fast-path uninstalled."

#!/usr/bin/env bash
#
# Uninstall the Mentor event-bus stack.
#
# Usage:
#   ./packages/mentor-event-bus/scripts/uninstall.sh           # bootout + remove plists; PRESERVE events.sqlite + secret
#   ./packages/mentor-event-bus/scripts/uninstall.sh --purge   # also delete events.sqlite + secret
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
SECRET_PATH="${CAIA_EVENT_BUS_SECRET_PATH:-${HOME}/.caia-vault/mentor-event-bus-secret}"

PLIST_LABELS=(
    "com.caia.mentor.server"
    "com.caia.mentor.memory-watcher"
)

if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: uninstall.sh runs on macOS only." >&2
    exit 2
fi

# Bootout + remove plists.
for label in "${PLIST_LABELS[@]}"; do
    dst="${LA_DIR}/${label}.plist"
    if launchctl list | grep -q "${label}"; then
        launchctl bootout "gui/$(id -u)" "${dst}" 2>/dev/null || true
        echo "  booted out ${label}"
    fi
    if [[ -f "${dst}" ]]; then
        rm -f "${dst}"
        echo "  removed ${dst}"
    fi
done

if (( PURGE == 1 )); then
    if [[ -d "${DB_DIR}" ]]; then
        rm -rf "${DB_DIR}"
        echo "  purged ${DB_DIR}"
    fi
    if [[ -f "${SECRET_PATH}" ]]; then
        rm -f "${SECRET_PATH}"
        echo "  purged ${SECRET_PATH}"
    fi
    if [[ -d "${LOG_DIR}" ]]; then
        rm -rf "${LOG_DIR}"
        echo "  purged ${LOG_DIR}"
    fi
else
    echo "  preserved ${DB_DIR}/ (use --purge to delete)"
    echo "  preserved ${SECRET_PATH} (use --purge to delete)"
    echo "  preserved ${LOG_DIR}/ (use --purge to delete)"
fi

echo
echo "✓ Mentor event-bus uninstalled."

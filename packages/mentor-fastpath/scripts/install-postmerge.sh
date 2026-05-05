#!/usr/bin/env bash
#
# Install the Mentor Phase-2 postmerge LaunchAgents on the operator's Mac.
#
# Installs TWO agents:
#   com.caia.mentor.postmerge-watcher  — polls gh, emits events
#   com.caia.mentor.postmerge-consumer — reads events, writes proposals
#
# Usage:
#   ./packages/mentor-fastpath/scripts/install-postmerge.sh
#
# Pre-conditions:
#   - macOS
#   - dist/postmerge/{watcher,consumer-cli}.js built
#     (`pnpm -F @chiefaia/mentor-fastpath build`)
#   - CAIA_MEMORY_DIR env var set
#   - mentor-event-bus server already installed (events.sqlite must exist)
#   - `gh` CLI authenticated (`gh auth status`)
#
# Idempotent: safe to re-run.

set -euo pipefail

# ─── Resolve paths ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${PACKAGE_DIR}/../.." && pwd)"
PLISTS_SRC="${PACKAGE_DIR}/plists"
LA_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/caia-mentor"
DB_DIR="${HOME}/Library/Application Support/caia/events"
DB_PATH="${CAIA_EVENT_BUS_DB_PATH:-${DB_DIR}/events.sqlite}"
MEMORY_DIR="${CAIA_MEMORY_DIR:-}"

WATCHER_LABEL="com.caia.mentor.postmerge-watcher"
CONSUMER_LABEL="com.caia.mentor.postmerge-consumer"

# ─── Verify pre-conditions ──────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: install-postmerge.sh runs on macOS only (uname=$(uname))." >&2
    exit 2
fi

if [[ -z "${MEMORY_DIR}" ]]; then
    echo "ERROR: CAIA_MEMORY_DIR is required." >&2
    echo "  export CAIA_MEMORY_DIR=/path/to/agent/memory" >&2
    exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: 'gh' CLI not found on PATH." >&2
    exit 2
fi

if ! gh auth status >/dev/null 2>&1; then
    echo "ERROR: 'gh' CLI is not authenticated. Run 'gh auth login' first." >&2
    exit 2
fi

WATCHER_DIST="${PACKAGE_DIR}/dist/postmerge/watcher/cli.js"
CONSUMER_DIST="${PACKAGE_DIR}/dist/postmerge/consumer-cli.js"
if [[ ! -f "${WATCHER_DIST}" ]] || [[ ! -f "${CONSUMER_DIST}" ]]; then
    echo "ERROR: dist not built. Run:" >&2
    echo "  pnpm -F @chiefaia/mentor-fastpath build" >&2
    exit 2
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "${NODE_BIN}" ]]; then
    echo "ERROR: 'node' not found on PATH." >&2
    exit 2
fi

# ─── Prepare host filesystem ────────────────────────────────────────────────
mkdir -p "${LA_DIR}" "${LOG_DIR}" "${MEMORY_DIR}/proposals"

install_one() {
    local label="$1"
    local plist_filename="${label}.plist"
    local src="${PLISTS_SRC}/${plist_filename}"
    local dst="${LA_DIR}/${plist_filename}"

    if [[ ! -f "${src}" ]]; then
        echo "ERROR: plist template missing: ${src}" >&2
        exit 2
    fi

    # Substitute placeholders
    sed \
        -e "s|__USER_HOME__|${HOME}|g" \
        -e "s|__REPO__|${REPO_ROOT}|g" \
        -e "s|__EVENTS_DB_PATH__|${DB_PATH}|g" \
        -e "s|__MEMORY_DIR__|${MEMORY_DIR}|g" \
        -e "s|__NODE_BIN__|${NODE_BIN}|g" \
        "${src}" >"${dst}"

    # Validate
    if ! plutil -lint "${dst}" >/dev/null; then
        echo "ERROR: plutil -lint failed for ${dst}" >&2
        exit 2
    fi

    # Bootstrap (or re-bootstrap)
    local domain="gui/$(id -u)"
    launchctl bootout "${domain}/${label}" 2>/dev/null || true
    launchctl bootstrap "${domain}" "${dst}"

    echo "✓ Installed ${label} → ${dst}"
}

install_one "${WATCHER_LABEL}"
install_one "${CONSUMER_LABEL}"

# ─── Wait briefly for daemons to register ──────────────────────────────────
echo "Waiting up to 60s for daemons to start..."
DOMAIN="gui/$(id -u)"
for i in $(seq 1 60); do
    WPID="$(launchctl list "${WATCHER_LABEL}" 2>/dev/null | awk '/"PID"/{print $3}' | tr -d ';')"
    CPID="$(launchctl list "${CONSUMER_LABEL}" 2>/dev/null | awk '/"PID"/{print $3}' | tr -d ';')"
    if [[ -n "${WPID:-}" && "${WPID}" != "0" && -n "${CPID:-}" && "${CPID}" != "0" ]]; then
        echo "✓ watcher PID=${WPID}  consumer PID=${CPID}"
        echo ""
        echo "Logs:"
        echo "  ${LOG_DIR}/postmerge-watcher.{out,err}.log"
        echo "  ${LOG_DIR}/postmerge-consumer.{out,err}.log"
        echo ""
        echo "Status:"
        echo "  ${WATCHER_DIST/cli.js/cli.js} status"
        echo "  ${CONSUMER_DIST} status"
        echo ""
        echo "To uninstall:"
        echo "  bash ${SCRIPT_DIR}/uninstall-postmerge.sh"
        exit 0
    fi
    sleep 1
done

echo "WARN: agents did not register a non-zero PID within 60s." >&2
echo "Check ${LOG_DIR}/*.err.log for details." >&2
echo "(The agents may still be running — launchctl list lookups can lag startup.)" >&2
exit 0

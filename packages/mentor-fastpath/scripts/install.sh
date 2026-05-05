#!/usr/bin/env bash
#
# Install the Mentor Phase-1 fast-path LaunchAgent on the operator's Mac.
#
# Usage:
#   ./packages/mentor-fastpath/scripts/install.sh
#
# What it installs:
#   1. Templates + copies plists/com.caia.mentor.fastpath.plist into
#      ~/Library/LaunchAgents/
#   2. Creates ~/Library/Logs/caia-mentor/ if missing
#   3. Creates <CAIA_MEMORY_DIR>/proposals/ if missing
#   4. launchctl bootstrap the agent
#   5. Verifies the daemon is alive within 30s
#
# Pre-conditions (will fail with a clear message if not met):
#   - macOS (uname == Darwin)
#   - dist/cli.js built (`pnpm -F @chiefaia/mentor-fastpath build`)
#   - CAIA_MEMORY_DIR env var set, pointing at the agent/memory dir
#   - mentor-event-bus already installed (events.sqlite must exist;
#     the fast-path opens it read-only)
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

PLIST_LABEL="com.caia.mentor.fastpath"

# ─── Verify pre-conditions ──────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: install.sh runs on macOS only (uname=$(uname))." >&2
    exit 2
fi

if [[ -z "${MEMORY_DIR}" ]]; then
    echo "ERROR: CAIA_MEMORY_DIR is required." >&2
    echo "  export CAIA_MEMORY_DIR=/path/to/agent/memory" >&2
    exit 2
fi

if [[ ! -d "${MEMORY_DIR}" ]]; then
    echo "ERROR: memory dir not found: ${MEMORY_DIR}" >&2
    exit 2
fi

if [[ ! -d "${PLISTS_SRC}" ]]; then
    echo "ERROR: plists source dir not found: ${PLISTS_SRC}" >&2
    exit 2
fi

if [[ ! -f "${PACKAGE_DIR}/dist/cli.js" ]]; then
    echo "ERROR: ${PACKAGE_DIR}/dist/cli.js not built. Run:" >&2
    echo "  pnpm -F @chiefaia/mentor-fastpath build" >&2
    exit 2
fi

if [[ ! -f "${DB_PATH}" ]]; then
    echo "WARN: events.sqlite not found at ${DB_PATH}." >&2
    echo "  The fast-path will idle (no events to read) until the" >&2
    echo "  mentor-event-bus is installed and produces events." >&2
fi

# Resolve node binary path (mirror mentor-event-bus install.sh logic).
if [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN="/opt/homebrew/bin/node"
elif [[ -x /usr/local/bin/node ]]; then
    NODE_BIN="/usr/local/bin/node"
else
    NODE_BIN="$(command -v node || true)"
    if [[ -z "${NODE_BIN}" ]]; then
        echo "ERROR: node not found." >&2
        exit 2
    fi
fi

# ─── Setup directories ──────────────────────────────────────────────────────
mkdir -p "${LA_DIR}" "${LOG_DIR}" "${MEMORY_DIR}/proposals"

# ─── Backup any existing plist ──────────────────────────────────────────────
BACKUP_DIR="${HOME}/.caia-backups/mentor-fastpath-launchagents-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${BACKUP_DIR}"
src="${LA_DIR}/${PLIST_LABEL}.plist"
if [[ -f "${src}" ]]; then
    cp "${src}" "${BACKUP_DIR}/"
    if launchctl list | grep -q "${PLIST_LABEL}"; then
        launchctl bootout "gui/$(id -u)" "${src}" 2>/dev/null || true
    fi
fi

# ─── Template + copy ────────────────────────────────────────────────────────
echo "Installing ${PLIST_LABEL} into ${LA_DIR}/"
echo "  events.sqlite  = ${DB_PATH}"
echo "  memory dir     = ${MEMORY_DIR}"
echo "  proposals dir  = ${MEMORY_DIR}/proposals"
echo "  node           = ${NODE_BIN}"
echo "  log dir        = ${LOG_DIR}"

src="${PLISTS_SRC}/${PLIST_LABEL}.plist"
dst="${LA_DIR}/${PLIST_LABEL}.plist"
sed \
    -e "s|__USER_HOME__|${HOME}|g" \
    -e "s|__REPO__|${REPO_ROOT}|g" \
    -e "s|__EVENTS_DB_PATH__|${DB_PATH}|g" \
    -e "s|__MEMORY_DIR__|${MEMORY_DIR}|g" \
    -e "s|__NODE_BIN__|${NODE_BIN}|g" \
    "${src}" > "${dst}"
echo "  installed ${PLIST_LABEL}.plist"

# ─── Validate plist syntax (catches sed substitution errors) ─────────────────
if command -v plutil >/dev/null 2>&1; then
    if ! plutil -lint "${dst}" >/dev/null 2>&1; then
        echo "ERROR: plutil -lint rejected ${dst}" >&2
        plutil -lint "${dst}" || true
        exit 2
    fi
fi

# ─── Bootstrap into launchd ─────────────────────────────────────────────────
echo
echo "Bootstrapping into launchd (gui/$(id -u))"
if launchctl bootstrap "gui/$(id -u)" "${dst}" 2>&1 | grep -v 'Bootstrap failed: 5: Input/output error'; then
    echo "  bootstrapped ${PLIST_LABEL}"
fi

# ─── Wait for fastpath liveness ─────────────────────────────────────────────
echo
echo "Waiting for ${PLIST_LABEL} to start ..."
attempt=0
max_attempts=30
ok=0
while (( attempt < max_attempts )); do
    if launchctl list | grep -q "${PLIST_LABEL}"; then
        # Confirm a real PID, not a "-" placeholder
        pid="$(launchctl list | awk -v label="${PLIST_LABEL}" '$3 == label { print $1 }')"
        if [[ "${pid}" != "-" && -n "${pid}" ]]; then
            ok=1
            break
        fi
    fi
    attempt=$((attempt + 1))
    sleep 1
done

if (( ok == 1 )); then
    echo
    echo "✓ ${PLIST_LABEL} is running (pid=${pid})"
    echo "✓ Watching:    ${DB_PATH}"
    echo "✓ Writing to:  ${MEMORY_DIR}/proposals/"
    echo "✓ Logs:        ${LOG_DIR}/fastpath.{out,err}.log"
    echo "✓ Backup:      ${BACKUP_DIR}/"
    echo
    echo "Next steps:"
    echo "  - Status:           caia-mentor-fastpath status"
    echo "  - Manual one-shot:  caia-mentor-fastpath process-once"
    echo "  - Plant a test:     caia-mentor record-correction \"stop asking\""
    echo "    (then check ${MEMORY_DIR}/proposals/ for a new file)"
else
    echo
    echo "WARN: ${PLIST_LABEL} did not register a PID within ${max_attempts}s." >&2
    echo "  See ${LOG_DIR}/fastpath.err.log for details." >&2
    exit 1
fi

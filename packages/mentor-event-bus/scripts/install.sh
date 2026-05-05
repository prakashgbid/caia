#!/usr/bin/env bash
#
# Install the Mentor event-bus stack on the operator's Mac.
#
# Usage:
#   ./packages/mentor-event-bus/scripts/install.sh
#
# What it installs:
#   1. Provisions ~/.caia-vault/mentor-event-bus-secret if missing
#      (32-byte secret via openssl rand -hex 32)
#   2. Templates + copies plists into ~/Library/LaunchAgents/com.caia.mentor.*.plist
#      - com.caia.mentor.server          (HTTP ingestion on 127.0.0.1:5180)
#      - com.caia.mentor.memory-watcher  (fs.watch on agent/memory)
#   3. Creates log + DB dirs
#   4. launchctl bootstrap each agent
#   5. Verifies /v1/healthz responds within 30s
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
SECRET_PATH="${CAIA_EVENT_BUS_SECRET_PATH:-${HOME}/.caia-vault/mentor-event-bus-secret}"
MEMORY_DIR="${CAIA_MEMORY_DIR:-${REPO_ROOT}/agent/memory}"

PLIST_LABELS=(
    "com.caia.mentor.server"
    "com.caia.mentor.memory-watcher"
)

# ─── Verify pre-conditions ──────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: install.sh runs on macOS only (uname=$(uname))." >&2
    exit 2
fi

if [[ ! -d "${PLISTS_SRC}" ]]; then
    echo "ERROR: plists source dir not found: ${PLISTS_SRC}" >&2
    exit 2
fi

if [[ ! -f "${PACKAGE_DIR}/dist/cli.js" ]]; then
    echo "ERROR: ${PACKAGE_DIR}/dist/cli.js not built. Run:" >&2
    echo "  pnpm -F @chiefaia/mentor-event-bus build" >&2
    exit 2
fi

if [[ ! -d "${MEMORY_DIR}" ]]; then
    echo "ERROR: memory dir not found: ${MEMORY_DIR}" >&2
    echo "  Set CAIA_MEMORY_DIR to point at the agent/memory directory." >&2
    exit 2
fi

# Resolve node binary path.
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

# ─── Secret provisioning ────────────────────────────────────────────────────
mkdir -p "$(dirname "${SECRET_PATH}")"
chmod 700 "$(dirname "${SECRET_PATH}")"
if [[ ! -f "${SECRET_PATH}" ]]; then
    if ! command -v openssl >/dev/null 2>&1; then
        echo "ERROR: openssl not found; cannot generate secret." >&2
        exit 2
    fi
    openssl rand -hex 32 > "${SECRET_PATH}"
    chmod 600 "${SECRET_PATH}"
    echo "Generated new secret at ${SECRET_PATH} (chmod 600)."
else
    SECRET_LEN="$(wc -c < "${SECRET_PATH}" | tr -d ' ')"
    if (( SECRET_LEN < 32 )); then
        echo "ERROR: existing secret at ${SECRET_PATH} is too short (${SECRET_LEN} bytes; need ≥32)." >&2
        echo "  Either delete it (re-run regenerates) or write a fresh one yourself." >&2
        exit 2
    fi
    echo "Reusing existing secret at ${SECRET_PATH}"
fi

# ─── Setup directories ──────────────────────────────────────────────────────
mkdir -p "${LA_DIR}" "${LOG_DIR}" "${DB_DIR}" "$(dirname "${DB_PATH}")"

# ─── Backup any existing plists ─────────────────────────────────────────────
BACKUP_DIR="${HOME}/.caia-backups/mentor-launchagents-$(date +%Y%m%d-%H%M%S)"
mkdir -p "${BACKUP_DIR}"
for label in "${PLIST_LABELS[@]}"; do
    src="${LA_DIR}/${label}.plist"
    if [[ -f "${src}" ]]; then
        cp "${src}" "${BACKUP_DIR}/"
        if launchctl list | grep -q "${label}"; then
            launchctl bootout "gui/$(id -u)" "${src}" 2>/dev/null || true
        fi
    fi
done

# ─── Template + copy ────────────────────────────────────────────────────────
echo "Installing mentor LaunchAgents into ${LA_DIR}/"
echo "  events.sqlite  = ${DB_PATH}"
echo "  secret file    = ${SECRET_PATH}"
echo "  memory dir     = ${MEMORY_DIR}"
echo "  node           = ${NODE_BIN}"
for label in "${PLIST_LABELS[@]}"; do
    src="${PLISTS_SRC}/${label}.plist"
    dst="${LA_DIR}/${label}.plist"
    if [[ ! -f "${src}" ]]; then
        echo "  WARN: source plist missing: ${src}" >&2
        continue
    fi
    sed \
        -e "s|__USER_HOME__|${HOME}|g" \
        -e "s|__REPO__|${REPO_ROOT}|g" \
        -e "s|__SECRET_PATH__|${SECRET_PATH}|g" \
        -e "s|__EVENTS_DB_PATH__|${DB_PATH}|g" \
        -e "s|__MEMORY_DIR__|${MEMORY_DIR}|g" \
        -e "s|__NODE_BIN__|${NODE_BIN}|g" \
        "${src}" > "${dst}"
    echo "  installed ${label}.plist"
done

# ─── Bootstrap into launchd ─────────────────────────────────────────────────
echo
echo "Bootstrapping into launchd (gui/$(id -u))"
for label in "${PLIST_LABELS[@]}"; do
    dst="${LA_DIR}/${label}.plist"
    if [[ ! -f "${dst}" ]]; then continue; fi
    if launchctl bootstrap "gui/$(id -u)" "${dst}" 2>&1 | grep -v 'Bootstrap failed: 5: Input/output error'; then
        echo "  bootstrapped ${label}"
    fi
done

# ─── Wait for server liveness ───────────────────────────────────────────────
echo
echo "Waiting for mentor-server on http://127.0.0.1:5180/v1/healthz ..."
attempt=0
max_attempts=30
ok=0
while (( attempt < max_attempts )); do
    if curl -fsS --max-time 2 http://127.0.0.1:5180/v1/healthz >/dev/null 2>&1; then
        ok=1
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
done

if (( ok == 1 )); then
    echo
    echo "✓ Mentor server is up: http://127.0.0.1:5180/"
    echo "✓ Memory watcher is watching: ${MEMORY_DIR}"
    echo "✓ Logs: ${LOG_DIR}/"
    echo "✓ Backup of any prior plists: ${BACKUP_DIR}/"
    echo
    echo "Next steps:"
    echo "  - Live tail events:  caia-mentor tail"
    echo "  - Quick count:       caia-mentor count"
    echo "  - Manual correction: caia-mentor record-correction \"...\""
else
    echo
    echo "WARN: mentor-server did not respond on /v1/healthz within ${max_attempts}s." >&2
    echo "  See ${LOG_DIR}/server.err.log for details." >&2
    exit 1
fi

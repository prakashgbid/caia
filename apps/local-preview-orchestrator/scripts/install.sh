#!/usr/bin/env bash
#
# Install LaunchAgents for the local-preview orchestrator on the operator's Mac.
#
# Usage:
#   ./scripts/install.sh
#
# Requires:
#   - macOS (launchctl)
#   - Node 20+ at /usr/local/bin/node OR /opt/homebrew/bin/node
#   - pnpm available on PATH
#   - This repo's `apps/local-preview-orchestrator` is built (`pnpm -F @caia-app/local-preview-orchestrator build`)
#
# What it installs:
#   1. Backs up any existing local-preview plists into ~/.caia-backups/launchagents-YYYYMMDD-HHMMSS/
#   2. Copies + templates plists into ~/Library/LaunchAgents/com.stolution.local-preview.*.plist
#   3. mkdir log + state dirs
#   4. launchctl bootstrap each agent (gui/$UID domain)
#   5. Verifies dashboard responds on http://127.0.0.1:5170/healthz within 30s
#
# Per-site branch overrides:
#   The deploy daemon resolves each site's branch from
#   `LOCAL_PREVIEW_<SITE>_BRANCH` env vars at runtime. install.sh templates
#   those values into the deploy-daemon plist's EnvironmentVariables block.
#   Set them in your shell before running install.sh; otherwise they fall
#   back to the bake-in defaults (develop/master/main):
#
#     LOCAL_PREVIEW_DASHBOARD_BRANCH=feature/foo \
#         ./scripts/install.sh
#
# Idempotent: safe to re-run; will bootout any pre-existing copy of each agent first.

set -euo pipefail

# ─── Resolve paths ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${APP_DIR}/../.." && pwd)"
PLISTS_SRC="${APP_DIR}/plists"
LA_DIR="${HOME}/Library/LaunchAgents"
LOG_DIR="${HOME}/Library/Logs/local-preview"
INSTALL_ROOT="${HOME}/Library/Application Support/Stolution/local-preview"
BACKUP_DIR="${HOME}/.caia-backups/launchagents-$(date +%Y%m%d-%H%M%S)"

# Site repo paths (override via env if you need to point elsewhere).
SITE_REPO_DASHBOARD="${SITE_REPO_DASHBOARD:-${REPO_ROOT}}"
SITE_REPO_POKER_ZENO="${SITE_REPO_POKER_ZENO:-${HOME}/Documents/projects/poker-zeno}"
SITE_REPO_ROULETTE_COMMUNITY="${SITE_REPO_ROULETTE_COMMUNITY:-${HOME}/Documents/projects/roulette-community}"

# Per-site branch overrides (PR-E). Defaults match SITE_DEFAULTS in sites-config.ts.
LOCAL_PREVIEW_DASHBOARD_BRANCH="${LOCAL_PREVIEW_DASHBOARD_BRANCH:-develop}"
LOCAL_PREVIEW_POKER_ZENO_BRANCH="${LOCAL_PREVIEW_POKER_ZENO_BRANCH:-master}"
LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH="${LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH:-main}"

# Validate branch refs against the same allowlist used by sites-config.ts and
# git-ops.shellEscape (alphanumerics, _, ., /, @, -, +). This is defence in
# depth — the runtime resolver also validates — but failing fast at install
# time is friendlier than a crash-loop after launchctl bootstrap.
_validate_branch() {
    local var_name="$1"
    local value="$2"
    if [[ ! "${value}" =~ ^[A-Za-z0-9_./@+\-]+$ ]]; then
        echo "ERROR: ${var_name}=\"${value}\" contains characters outside the allowlist [A-Za-z0-9_./@+-]." >&2
        exit 2
    fi
}
_validate_branch LOCAL_PREVIEW_DASHBOARD_BRANCH "${LOCAL_PREVIEW_DASHBOARD_BRANCH}"
_validate_branch LOCAL_PREVIEW_POKER_ZENO_BRANCH "${LOCAL_PREVIEW_POKER_ZENO_BRANCH}"
_validate_branch LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH "${LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH}"

# ─── Verify pre-conditions ──────────────────────────────────────────────────
if [[ "$(uname)" != "Darwin" ]]; then
    echo "ERROR: install.sh runs on macOS only (uname=$(uname))." >&2
    exit 2
fi

if [[ ! -d "${PLISTS_SRC}" ]]; then
    echo "ERROR: plists source dir not found: ${PLISTS_SRC}" >&2
    exit 2
fi

if [[ ! -f "${APP_DIR}/dist/cli.js" ]]; then
    echo "ERROR: ${APP_DIR}/dist/cli.js not built. Run:" >&2
    echo "  pnpm -F @caia-app/local-preview-orchestrator build" >&2
    exit 2
fi

# Resolve a node binary path that the plist can hard-code.
if [[ -x /opt/homebrew/bin/node ]]; then
    NODE_BIN="/opt/homebrew/bin/node"
elif [[ -x /usr/local/bin/node ]]; then
    NODE_BIN="/usr/local/bin/node"
else
    NODE_BIN="$(command -v node || true)"
    if [[ -z "${NODE_BIN}" ]]; then
        echo "ERROR: node not found on PATH or at common install locations." >&2
        exit 2
    fi
fi

# ─── Setup directories ──────────────────────────────────────────────────────
mkdir -p "${LA_DIR}" "${LOG_DIR}" "${INSTALL_ROOT}" "${BACKUP_DIR}"
mkdir -p "${INSTALL_ROOT}/dashboard/builds" \
         "${INSTALL_ROOT}/poker-zeno/builds" \
         "${INSTALL_ROOT}/roulette-community/builds" \
         "${INSTALL_ROOT}/_incidents"

PLIST_LABELS=(
    "com.stolution.local-preview.deploy-daemon"
    "com.stolution.local-preview.status-dashboard"
    "com.stolution.local-preview.dashboard"
    "com.stolution.local-preview.poker-zeno"
    "com.stolution.local-preview.roulette-community"
)

# ─── Backup + bootout any existing plists ───────────────────────────────────
echo "Backing up existing plists to ${BACKUP_DIR}/"
for label in "${PLIST_LABELS[@]}"; do
    src="${LA_DIR}/${label}.plist"
    if [[ -f "${src}" ]]; then
        cp "${src}" "${BACKUP_DIR}/"
        echo "  backed up ${label}.plist"
        # bootout if loaded
        if launchctl list | grep -q "${label}"; then
            launchctl bootout "gui/$(id -u)" "${src}" 2>/dev/null || true
        fi
    fi
done

# ─── Substitute templates + copy ────────────────────────────────────────────
echo
echo "Installing plists into ${LA_DIR}/"
echo "  per-site branches:"
echo "    dashboard           = ${LOCAL_PREVIEW_DASHBOARD_BRANCH}"
echo "    poker-zeno          = ${LOCAL_PREVIEW_POKER_ZENO_BRANCH}"
echo "    roulette-community  = ${LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH}"
for label in "${PLIST_LABELS[@]}"; do
    src="${PLISTS_SRC}/${label}.plist"
    dst="${LA_DIR}/${label}.plist"
    if [[ ! -f "${src}" ]]; then
        echo "  WARN: source plist missing: ${src}"
        continue
    fi
    sed \
        -e "s|__USER_HOME__|${HOME}|g" \
        -e "s|__REPO__|${REPO_ROOT}|g" \
        -e "s|__SITE_REPO_POKER_ZENO__|${SITE_REPO_POKER_ZENO}|g" \
        -e "s|__SITE_REPO_ROULETTE_COMMUNITY__|${SITE_REPO_ROULETTE_COMMUNITY}|g" \
        -e "s|__LOCAL_PREVIEW_DASHBOARD_BRANCH__|${LOCAL_PREVIEW_DASHBOARD_BRANCH}|g" \
        -e "s|__LOCAL_PREVIEW_POKER_ZENO_BRANCH__|${LOCAL_PREVIEW_POKER_ZENO_BRANCH}|g" \
        -e "s|__LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH__|${LOCAL_PREVIEW_ROULETTE_COMMUNITY_BRANCH}|g" \
        -e "s|/usr/local/bin/node|${NODE_BIN}|g" \
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

# ─── Wait for dashboard liveness ────────────────────────────────────────────
echo
echo "Waiting for status-dashboard to come up on http://127.0.0.1:5170/healthz ..."
attempt=0
max_attempts=30
ok=0
while (( attempt < max_attempts )); do
    if curl -fsS --max-time 2 http://127.0.0.1:5170/healthz >/dev/null 2>&1; then
        ok=1
        break
    fi
    attempt=$((attempt + 1))
    sleep 1
done

if (( ok == 1 )); then
    echo
    echo "✓ Status dashboard is up: http://127.0.0.1:5170/"
    echo "✓ Logs: ${LOG_DIR}/"
    echo "✓ Backup of any prior plists: ${BACKUP_DIR}/"
    echo
    echo "Next steps:"
    echo "  - Visit http://127.0.0.1:5170/ to see site status."
    echo "  - First deploy will trigger automatically within 30s."
    echo "  - Check progress: ./scripts/status.sh"
else
    echo
    echo "WARN: dashboard did not respond on /healthz within ${max_attempts}s." >&2
    echo "  See ${LOG_DIR}/status-dashboard.err.log for details." >&2
    exit 1
fi

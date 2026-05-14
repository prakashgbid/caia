#!/usr/bin/env bash
# Install the Apprentice Phase 2 training LaunchAgent (DISABLED by default).
#
# Phase 2 ships this disabled. Phase 4 (retrainer cron) is what activates
# scheduled retraining. Operator can also kickstart manually for ad-hoc runs.
#
# Pattern follows `feedback_monorepo_regression_gate_ergonomics.md` rule 2:
# placeholders substituted at install time; modern launchctl bootstrap;
# plutil -lint enforced; CAIA_DRY_INSTALL=1 mode for CI sanity.
#
# Usage:
#   scripts/install-apprentice-training.sh
#
# Env-var overrides:
#   CAIA_NODE_BIN        — node binary (default: $(command -v node))
#   CAIA_PYTHON_BIN      — python binary with mlx-lm installed
#                          (default: ~/Documents/projects/apprentice/venv/bin/python)
#   CAIA_PATH            — PATH for the LaunchAgent process
#                          (default: /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin)
#   CAIA_DRY_INSTALL=1   — render + lint + verify, don't touch launchd
#   --no-kickstart       — don't kickstart the agent after install (default kickstart-skip
#                          since Phase 2 ships disabled)

set -euo pipefail

NO_KICKSTART="${1:-}"
DRY_INSTALL="${CAIA_DRY_INSTALL:-0}"

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PKG_DIR/plists/com.chiefaia.apprentice-training.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.chiefaia.apprentice-training.plist"
SERVICE_TARGET="gui/$(id -u)/com.chiefaia.apprentice-training"
LOG_DIR="$HOME/Library/Logs/chiefaia"
LOG_FILE="$LOG_DIR/apprentice-training.log"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "missing plist source: $PLIST_SRC" >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "package not built: $PKG_DIR/dist" >&2
  echo "run 'pnpm --filter @chiefaia/apprentice-training build' first" >&2
  exit 1
fi

# Refuse to install if node major version doesn't match expected (default 22).
# shellcheck source=/dev/null
source "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/lib/check-node-version.sh"
NODE_BIN="$(check_node_version)"

PYTHON_BIN="${CAIA_PYTHON_BIN:-$HOME/Documents/projects/apprentice/venv/bin/python}"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "WARNING: configured python binary not executable: $PYTHON_BIN" >&2
  echo "  install mlx-lm into a venv: python3.13 -m venv $HOME/Documents/projects/apprentice/venv && $HOME/Documents/projects/apprentice/venv/bin/pip install mlx-lm" >&2
  echo "  the LaunchAgent will fail until this is fixed" >&2
fi

PATH_DEFAULT="${CAIA_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"

mkdir -p "$LOG_DIR"

# Substitute placeholders.
sed \
  -e "s|CURRENT_NODE_BIN|$NODE_BIN|g" \
  -e "s|CURRENT_PYTHON_BIN|$PYTHON_BIN|g" \
  -e "s|CURRENT_PKG_DIR|$PKG_DIR|g" \
  -e "s|CURRENT_HOME|$HOME|g" \
  -e "s|CURRENT_PATH|$PATH_DEFAULT|g" \
  "$PLIST_SRC" > "$PLIST_DST"

# Lint the rendered plist.
plutil -lint "$PLIST_DST" >/dev/null

if [[ "$DRY_INSTALL" == "1" ]]; then
  echo "CAIA_DRY_INSTALL=1: rendered + linted at $PLIST_DST"
  echo "Phase 2 ships DISABLED — operator must explicitly enable when Phase 4 ships."
  exit 0
fi

# Modern launchd lifecycle: bootout (ignore-errors) → bootstrap.
launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "installed LaunchAgent: $PLIST_DST"
echo "service target: $SERVICE_TARGET"
echo "logs: $LOG_FILE"
echo "schedule: Saturday 02:00 local (DISABLED — operator must enable when Phase 4 ships)"

# Phase 2 ships DISABLED — never kickstart by default.
if [[ "$NO_KICKSTART" != "--no-kickstart" && "$NO_KICKSTART" != "" ]]; then
  echo "(Phase 2 plist is committed with Disabled=true; --kickstart would still run; not auto-firing.)"
fi

#!/usr/bin/env bash
# Install the Apprentice Phase 4 retrainer LaunchAgent.
#
# Phase 4 SHIPS ENABLED — this is the activation point for the full
# Apprentice loop (corpus → train → eval → register → promote-canary
# weekly Saturday 02:00 local).
#
# Pattern follows `feedback_monorepo_regression_gate_ergonomics.md` rule 2:
# placeholders substituted at install time; modern launchctl bootstrap;
# plutil -lint enforced; CAIA_DRY_INSTALL=1 mode for CI sanity.
#
# Usage:
#   scripts/install-apprentice-retrainer.sh [--no-kickstart]
#
# Env-var overrides:
#   CAIA_NODE_BIN        — node binary (default: $(command -v node))
#   CAIA_PATH            — PATH for the LaunchAgent process
#                          (default: /opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin)
#   CAIA_DRY_INSTALL=1   — render + lint + verify, don't touch launchd

set -euo pipefail

NO_KICKSTART="${1:-}"
DRY_INSTALL="${CAIA_DRY_INSTALL:-0}"

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PKG_DIR/plists/com.chiefaia.apprentice-retrainer.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.chiefaia.apprentice-retrainer.plist"
SERVICE_TARGET="gui/$(id -u)/com.chiefaia.apprentice-retrainer"
LOG_DIR="$HOME/Library/Logs/chiefaia"
LOG_FILE="$LOG_DIR/apprentice-retrainer.log"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "missing plist source: $PLIST_SRC" >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "package not built: $PKG_DIR/dist" >&2
  echo "run 'pnpm --filter @chiefaia/apprentice-retrainer build' first" >&2
  exit 1
fi

# Native binaries in the pnpm store are built against Node 22 (NODE_MODULE_VERSION 127).
# Prefer node@22 by default so the retrainer process doesn't ABI-fail under newer
# Homebrew node. CAIA_NODE_BIN overrides.
if [[ -n "${CAIA_NODE_BIN:-}" ]]; then
  NODE_BIN="$CAIA_NODE_BIN"
elif [[ -x /opt/homebrew/opt/node@22/bin/node ]]; then
  NODE_BIN="/opt/homebrew/opt/node@22/bin/node"
else
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "node binary not found on PATH; set CAIA_NODE_BIN" >&2
  exit 1
fi

PATH_DEFAULT="${CAIA_PATH:-/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin}"

mkdir -p "$LOG_DIR"

# Substitute placeholders.
sed \
  -e "s|CURRENT_NODE_BIN|$NODE_BIN|g" \
  -e "s|CURRENT_PKG_DIR|$PKG_DIR|g" \
  -e "s|CURRENT_HOME|$HOME|g" \
  -e "s|CURRENT_PATH|$PATH_DEFAULT|g" \
  "$PLIST_SRC" > "$PLIST_DST"

# Lint the rendered plist.
plutil -lint "$PLIST_DST" >/dev/null

if [[ "$DRY_INSTALL" == "1" ]]; then
  echo "CAIA_DRY_INSTALL=1: rendered + linted at $PLIST_DST"
  echo "Phase 4 ships ENABLED — would bootstrap on real install."
  exit 0
fi

# Modern launchd lifecycle: bootout (ignore-errors) → bootstrap.
launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "installed LaunchAgent: $PLIST_DST"
echo "service target: $SERVICE_TARGET"
echo "logs: $LOG_FILE"
echo "schedule: Saturday 02:00 local (ENABLED)"

# Optional kickstart — useful for first-run validation.
if [[ "$NO_KICKSTART" != "--no-kickstart" ]]; then
  echo "(use --no-kickstart to skip immediate run)"
fi

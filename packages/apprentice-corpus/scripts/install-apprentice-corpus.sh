#!/usr/bin/env bash
# Install the @chiefaia/apprentice-corpus LaunchAgent.
#
# Renders the plist with the current orchestrator session id, node binary path,
# package directory, $HOME and claude binary path; copies to
# ~/Library/LaunchAgents/; bootstraps via `launchctl bootstrap` (modern
# replacement for `launchctl load`); kickstarts a one-off run for immediate
# verification. Idempotent: bootouts any existing instance first.
#
# Usage:
#   scripts/install-apprentice-corpus.sh <orchestrator-session-id> [--no-kickstart]
#
# The session id is the path component(s) under
# "$HOME/Library/Application Support/Claude/local-agent-mode-sessions/"
# that contains the current agent/memory directory. May be a single uuid or
# a uuid/uuid pair separated by a forward slash.
#
# Set CAIA_DRY_INSTALL=1 to render + verify the plist without bootstrapping
# launchd — useful for CI / local sanity checks.
#
# Environment overrides (optional):
#   CAIA_NODE_BIN     path to node (default: $(command -v node))
#   CAIA_CLAUDE_BIN   path to claude binary (default: $(command -v claude) or /usr/local/bin/claude)
#   CAIA_PATH         PATH to bake into the LaunchAgent (default: a sensible Mac default)
#
# Manual ops post-install:
#   launchctl kickstart -k gui/$(id -u)/com.chiefaia.apprentice-corpus
#   tail -f ~/Library/Logs/chiefaia/apprentice-corpus.log
#   launchctl bootout gui/$(id -u)/com.chiefaia.apprentice-corpus    # uninstall

set -euo pipefail

LABEL="com.chiefaia.apprentice-corpus"

usage() {
  cat <<EOF
usage: $0 <orchestrator-session-id> [--no-kickstart]

  e.g. $0 6c9158cd-cd01-44af-b82f-bf27b437c618/84f7697e-7ae3-4ba4-9f98-166613a82e98

Set CAIA_DRY_INSTALL=1 to render + verify the plist without bootstrapping launchd.
EOF
  exit 2
}

if [[ "${1:-}" == "" || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
fi

SESSION_ID="$1"
KICKSTART=1
if [[ "${2:-}" == "--no-kickstart" ]]; then
  KICKSTART=0
fi

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PKG_DIR/plists/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$HOME/Library/Logs/chiefaia"
DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$DOMAIN/$LABEL"

CLAUDE_BIN="${CAIA_CLAUDE_BIN:-$(command -v claude || echo /usr/local/bin/claude)}"
DEFAULT_PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
RENDERED_PATH="${CAIA_PATH:-$DEFAULT_PATH}"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "missing plist source: $PLIST_SRC" >&2
  exit 1
fi

if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "missing $PKG_DIR/dist — run 'pnpm --filter @chiefaia/apprentice-corpus build' first" >&2
  exit 1
fi

# Refuse to install if node major version doesn't match expected (default 22).
# See scripts/lib/check-node-version.sh for the rationale (better-sqlite3 ABI lock).
# shellcheck source=/dev/null
source "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/lib/check-node-version.sh"
NODE_BIN="$(check_node_version)"

mkdir -p "$LOG_DIR"
mkdir -p "$(dirname "$PLIST_DST")"

# sed pipeline: substitute the four CURRENT_* placeholders. Use | as delimiter
# because $HOME and $PKG_DIR contain slashes.
sed \
  -e "s|CURRENT_NODE_BIN|$NODE_BIN|g" \
  -e "s|CURRENT_CLAUDE_BIN|$CLAUDE_BIN|g" \
  -e "s|CURRENT_PKG_DIR|$PKG_DIR|g" \
  -e "s|CURRENT_HOME|$HOME|g" \
  -e "s|CURRENT_PATH|$RENDERED_PATH|g" \
  -e "s|CURRENT_SESSION_ID|$SESSION_ID|g" \
  "$PLIST_SRC" > "$PLIST_DST"

# Verify the rendered plist parses
if ! plutil -lint "$PLIST_DST" >/dev/null 2>&1; then
  echo "rendered plist failed plutil -lint:" >&2
  plutil -lint "$PLIST_DST" >&2 || true
  exit 1
fi

if [[ "${CAIA_DRY_INSTALL:-0}" == "1" ]]; then
  echo "dry-install: rendered $PLIST_DST (skipped launchctl)"
  exit 0
fi

# Bootout any prior instance of the service (ignore failure — it may not exist)
launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true

# Bootstrap the new instance
launchctl bootstrap "$DOMAIN" "$PLIST_DST"

# Verify launchd took it
if ! launchctl print "$SERVICE_TARGET" >/dev/null 2>&1; then
  echo "launchctl bootstrap apparently succeeded but service is not visible: $SERVICE_TARGET" >&2
  exit 1
fi

echo "installed LaunchAgent: $PLIST_DST"
echo "service target: $SERVICE_TARGET"
echo "logs: $LOG_DIR/apprentice-corpus.log"
echo "next scheduled run: 02:00 local"

if [[ "$KICKSTART" == "1" ]]; then
  echo "kickstarting one-off run to verify the agent loads…"
  launchctl kickstart -k "$SERVICE_TARGET"
  echo "kickstart issued. Tail logs at $LOG_DIR/apprentice-corpus.log"
fi

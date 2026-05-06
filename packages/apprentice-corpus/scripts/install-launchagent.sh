#!/usr/bin/env bash
# Install the Apprentice corpus aggregator LaunchAgent.
#
# Usage:
#   scripts/install-launchagent.sh <orchestrator-session-id>
#
# The session id is the path component under ~/Library/Application Support/Claude/local-agent-mode-sessions/
# that contains the current agent/memory directory.

set -euo pipefail

if [[ "${1:-}" == "" ]]; then
  echo "usage: $0 <orchestrator-session-id>"
  echo "  e.g. $0 6c9158cd-cd01-44af-b82f-bf27b437c618/84f7697e-7ae3-4ba4-9f98-166613a82e98"
  exit 2
fi

SESSION_ID="$1"
PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PKG_DIR/plists/com.chiefaia.apprentice-corpus.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.chiefaia.apprentice-corpus.plist"
LOG_DIR="$HOME/Library/Logs/chiefaia"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "missing plist source: $PLIST_SRC" >&2
  exit 1
fi

mkdir -p "$LOG_DIR"

# Patch the session id into a copy of the plist
sed "s|CURRENT_SESSION_ID|$SESSION_ID|g" "$PLIST_SRC" > "$PLIST_DST"

# Reload the agent
launchctl unload "$PLIST_DST" 2>/dev/null || true
launchctl load "$PLIST_DST"

echo "installed LaunchAgent: $PLIST_DST"
echo "logs: $LOG_DIR/apprentice-corpus.log"
echo "next run: tomorrow at 02:00 local"

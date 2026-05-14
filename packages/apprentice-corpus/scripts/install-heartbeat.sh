#!/usr/bin/env bash
# Install the daily corpus heartbeat watchdog LaunchAgent.
#
# Schedule: 04:00 local — two hours after the 02:00 corpus aggregator.
# Alerts via stderr (routed by launchd to the err log) when today's
# `totals.final` is below 80% of yesterday's, i.e. a 20%+ drop.

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PLIST_SRC="$PKG_DIR/plists/com.chiefaia.apprentice-corpus-heartbeat.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.chiefaia.apprentice-corpus-heartbeat.plist"
SERVICE_TARGET="gui/$(id -u)/com.chiefaia.apprentice-corpus-heartbeat"
LOG_DIR="$HOME/Library/Logs/chiefaia"

if [[ ! -f "$PLIST_SRC" ]]; then
  echo "missing plist source: $PLIST_SRC" >&2
  exit 1
fi

# Refuse to install if node major version doesn't match expected (default 22).
# Native modules (better-sqlite3) require the binary to match the runtime.
# shellcheck source=/dev/null
source "$(cd "$(dirname "$0")/../../.." && pwd)/scripts/lib/check-node-version.sh"
NODE_BIN="$(check_node_version)"

mkdir -p "$LOG_DIR"

sed \
  -e "s|CURRENT_NODE_BIN|$NODE_BIN|g" \
  -e "s|CURRENT_PKG_DIR|$PKG_DIR|g" \
  -e "s|CURRENT_HOME|$HOME|g" \
  "$PLIST_SRC" > "$PLIST_DST"

plutil -lint "$PLIST_DST" >/dev/null

launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_DST"

echo "installed: $PLIST_DST"
echo "service:   $SERVICE_TARGET"
echo "schedule:  daily 04:00 local"
echo "logs:      $LOG_DIR/apprentice-corpus-heartbeat.{,err.}log"

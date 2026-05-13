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

# Native module ABI (see install-apprentice-retrainer.sh for context).
if [[ -n "${CAIA_NODE_BIN:-}" ]]; then
  NODE_BIN="$CAIA_NODE_BIN"
elif [[ -x /opt/homebrew/opt/node@22/bin/node ]]; then
  NODE_BIN="/opt/homebrew/opt/node@22/bin/node"
else
  NODE_BIN="$(command -v node 2>/dev/null || true)"
fi
if [[ -z "$NODE_BIN" ]]; then
  echo "node binary not found; set CAIA_NODE_BIN" >&2
  exit 1
fi

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

#!/usr/bin/env bash
# register-outcome-steward.sh — bootstrap the outcome-steward LaunchAgent.
#
# Idempotent: safe to re-run; refreshes plist + rebuild dist + kickstart.
#
# Operator usage:
#   bash packages/outcome-steward/scripts/register-outcome-steward.sh
#
# Steps:
#   1. Build the package.
#   2. Ensure ~/.caia/outcome-steward/ exists.
#   3. Ensure ~/Library/Logs/caia/ exists.
#   4. Copy the plist into ~/Library/LaunchAgents/.
#   5. launchctl bootstrap gui/$(id -u) <plist> (bootout first if loaded).
#   6. launchctl kickstart -k gui/$(id -u)/com.caia.outcome-steward-hourly.
#   7. Print the first cycle's status.json + tail of out.log.

set -euo pipefail

LABEL="com.caia.outcome-steward-hourly"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PLIST_SRC="$HERE/launchd/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.caia/outcome-steward"
LOG_DIR="$HOME/Library/Logs/caia"
DOMAIN="gui/$(id -u)"

echo "→ build @caia/outcome-steward"
(cd "$REPO_ROOT" && pnpm --filter @caia/outcome-steward build) >/dev/null

echo "→ ensure state dir $STATE_DIR"
mkdir -p "$STATE_DIR"

echo "→ ensure log dir $LOG_DIR"
mkdir -p "$LOG_DIR"

echo "→ install plist $PLIST_DST"
cp "$PLIST_SRC" "$PLIST_DST"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "→ bootout existing $LABEL"
  launchctl bootout "$DOMAIN/$LABEL" || true
fi

echo "→ bootstrap $LABEL"
launchctl bootstrap "$DOMAIN" "$PLIST_DST"

echo "→ kickstart one cycle"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo ""
echo "✓ registered. First-cycle artifacts (allow a few seconds):"
sleep 3
echo ""
echo "── ~/.caia/outcome-steward/status.json ──"
if [[ -f "$STATE_DIR/status.json" ]]; then
  cat "$STATE_DIR/status.json"
else
  echo "(not yet written — run hasn't completed; check log below)"
fi
echo ""
echo "── ~/Library/Logs/caia/outcome-steward.out.log (last 20 lines) ──"
if [[ -f "$LOG_DIR/outcome-steward.out.log" ]]; then
  tail -n 20 "$LOG_DIR/outcome-steward.out.log"
else
  echo "(no log yet)"
fi
echo ""
echo "── ~/Library/Logs/caia/outcome-steward.err.log (last 20 lines) ──"
if [[ -f "$LOG_DIR/outcome-steward.err.log" ]]; then
  tail -n 20 "$LOG_DIR/outcome-steward.err.log"
else
  echo "(no err log yet — that's good)"
fi
echo ""
echo "Manage:"
echo "  launchctl list | grep $LABEL"
echo "  launchctl print $DOMAIN/$LABEL"
echo "  launchctl bootout $DOMAIN/$LABEL    # to unregister"

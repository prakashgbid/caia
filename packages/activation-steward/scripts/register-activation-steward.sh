#!/usr/bin/env bash
# register-activation-steward.sh — bootstrap the activation-steward LaunchAgent.
#
# Idempotent: safe to re-run; will refresh the plist + rebuild dist + kickstart.
#
# Operator usage:
#   bash packages/activation-steward/scripts/register-activation-steward.sh
#
# Steps:
#   1. Build the package (`pnpm --filter @caia/activation-steward build`).
#   2. Ensure `~/.caia/activation-steward/` exists.
#   3. Ensure `~/Library/Logs/caia/` exists.
#   4. Copy the plist into `~/Library/LaunchAgents/`.
#   5. `launchctl bootstrap gui/$(id -u) <plist>` (idempotent: bootout first if loaded).
#   6. `launchctl kickstart -k gui/$(id -u)/com.caia.activation-steward-hourly`.
#   7. Print the first cycle's status.json + tail of out.log.

set -euo pipefail

LABEL="com.caia.activation-steward-hourly"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PLIST_SRC="$HERE/launchd/$LABEL.plist"
PLIST_DST="$HOME/Library/LaunchAgents/$LABEL.plist"
STATE_DIR="$HOME/.caia/activation-steward"
LOG_DIR="$HOME/Library/Logs/caia"
DOMAIN="gui/$(id -u)"

echo "→ build @caia/activation-steward"
(cd "$REPO_ROOT" && pnpm --filter @caia/activation-steward build) >/dev/null

echo "→ ensure state dir $STATE_DIR"
mkdir -p "$STATE_DIR"

echo "→ ensure log dir $LOG_DIR"
mkdir -p "$LOG_DIR"

echo "→ install plist $PLIST_DST"
cp "$PLIST_SRC" "$PLIST_DST"

# launchctl bootstrap fails if the service is already loaded; bootout first.
if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  echo "→ bootout existing $LABEL"
  launchctl bootout "$DOMAIN/$LABEL" || true
fi

echo "→ bootstrap $LABEL"
launchctl bootstrap "$DOMAIN" "$PLIST_DST"

echo "→ kickstart one cycle"
launchctl kickstart -k "$DOMAIN/$LABEL"

echo ""
echo "✓ registered. First-cycle artifacts (allow a few seconds for the run to finish):"
sleep 3
echo ""
echo "── ~/.caia/activation-steward/status.json ──"
if [[ -f "$STATE_DIR/status.json" ]]; then
  cat "$STATE_DIR/status.json"
else
  echo "(not yet written — run hasn't completed; check log below)"
fi
echo ""
echo "── ~/Library/Logs/caia/activation-steward.out.log (last 20 lines) ──"
if [[ -f "$LOG_DIR/activation-steward.out.log" ]]; then
  tail -n 20 "$LOG_DIR/activation-steward.out.log"
else
  echo "(no log yet)"
fi
echo ""
echo "── ~/Library/Logs/caia/activation-steward.err.log (last 20 lines) ──"
if [[ -f "$LOG_DIR/activation-steward.err.log" ]]; then
  tail -n 20 "$LOG_DIR/activation-steward.err.log"
else
  echo "(no err log yet — that's good)"
fi
echo ""
echo "Manage:"
echo "  launchctl list | grep $LABEL"
echo "  launchctl print $DOMAIN/$LABEL"
echo "  launchctl bootout $DOMAIN/$LABEL    # to unregister"

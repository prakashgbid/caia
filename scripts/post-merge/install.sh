#!/usr/bin/env bash
# INT.1.A1 — install/refresh the post-merge watcher and deploy stub on the
# operator's Mac. Idempotent — safe to re-run after each merge.
#
# - Copies the watcher + deploy script into ~/.caia/post-merge/
# - Renders the launchd plist into ~/Library/LaunchAgents/
# - Re-bootstraps com.caia.post-merge-watcher

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DIR="$REPO_ROOT/scripts/post-merge"
PLIST_TEMPLATE="$REPO_ROOT/launchd/com.caia.post-merge-watcher.plist.template"

POSTMERGE_HOME="${POSTMERGE_HOME:-$HOME/.caia/post-merge}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_LABEL="com.caia.post-merge-watcher"
PLIST_PATH="$LAUNCH_AGENTS_DIR/${PLIST_LABEL}.plist"

mkdir -p "$POSTMERGE_HOME" "$LAUNCH_AGENTS_DIR"

install -m 0755 "$SRC_DIR/post-merge-watcher.sh" "$POSTMERGE_HOME/post-merge-watcher.sh"
install -m 0755 "$SRC_DIR/post-merge-deploy.sh"  "$POSTMERGE_HOME/post-merge-deploy.sh"

if [[ ! -f "$PLIST_TEMPLATE" ]]; then
  echo "FATAL: plist template missing: $PLIST_TEMPLATE" >&2
  exit 1
fi

# Render template — one substitution: {{HOME}}
sed "s#{{HOME}}#${HOME}#g" "$PLIST_TEMPLATE" > "$PLIST_PATH"

# Re-bootstrap (bootout is best-effort if not already loaded).
launchctl bootout "gui/$(id -u)" "$PLIST_PATH" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_PATH"
launchctl enable "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true
launchctl kickstart "gui/$(id -u)/${PLIST_LABEL}" 2>/dev/null || true

echo "post-merge-watcher installed and bootstrapped."
echo "  state dir: $POSTMERGE_HOME"
echo "  plist:     $PLIST_PATH"
echo "  status:    launchctl print gui/$(id -u)/${PLIST_LABEL}"

#!/usr/bin/env bash
# scripts/migrate-launchd.sh
# Re-points conductor launchd jobs from old paths (conductor/, plugins/) to new caia/ paths.
# Run AFTER `caia/` is built locally (apps/orchestrator/dist exists, etc.).
#
# Usage:
#   bash scripts/migrate-launchd.sh           # dry-run by default
#   bash scripts/migrate-launchd.sh --apply   # actually rewrite + bootout/bootstrap
set -euo pipefail

CAIA_ROOT="${CAIA_ROOT:-/Users/MAC/Documents/projects/caia}"
APPLY="${1:-}"

declare -A REWRITES=(
  ["com.conductor.executor"]="$HOME/Documents/projects/conductor/dist/src/cli/index.js|$CAIA_ROOT/apps/orchestrator/dist/src/cli/index.js"
  ["com.conductor.mcp"]="$HOME/Documents/projects/conductor/dist/cli/index.js|$CAIA_ROOT/apps/orchestrator/dist/cli/index.js"
  ["com.conductor.completeness-sentinel"]="$HOME/Documents/projects/plugins/completeness-sentinel/dist/daemon.cjs|$CAIA_ROOT/apps/completeness-sentinel/dist/daemon.cjs"
  ["com.conductor.db-backup"]="$HOME/Documents/projects/conductor/apps/db-backup/run-backup.sh|$CAIA_ROOT/apps/db-backup/run-backup.sh"
  ["com.conductor.story-backfiller"]="$HOME/Documents/projects/conductor/apps/story-backfiller/index.cjs|$CAIA_ROOT/apps/story-backfiller/index.cjs"
  ["com.conductor.task-run-poller"]="$HOME/Documents/projects/conductor/apps/task-run-poller/index.cjs|$CAIA_ROOT/apps/task-run-poller/index.cjs"
)

LAUNCHD_DIR="$HOME/Library/LaunchAgents"

for label in "${!REWRITES[@]}"; do
  IFS='|' read -r OLD NEW <<<"${REWRITES[$label]}"
  PLIST="$LAUNCHD_DIR/$label.plist"
  if [ ! -f "$PLIST" ]; then
    echo "  [skip] $label — plist not present"
    continue
  fi
  if grep -q "$NEW" "$PLIST"; then
    echo "  [done] $label — already points at $NEW"
    continue
  fi
  if ! grep -q "$OLD" "$PLIST"; then
    echo "  [warn] $label — does not match expected old path; manual review:"
    /usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$PLIST" | sed 's/^/        /'
    continue
  fi

  echo "  [rewrite] $label"
  echo "    OLD: $OLD"
  echo "    NEW: $NEW"

  if [ "$APPLY" = "--apply" ]; then
    cp "$PLIST" "$PLIST.bak.$(date +%Y%m%d-%H%M%S)"
    sed -i '' "s|$OLD|$NEW|g" "$PLIST"
    echo "    [applied] backup at $PLIST.bak.*"
    echo "    [bootout] launchctl bootout gui/$(id -u) $PLIST || true"
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    echo "    [bootstrap] launchctl bootstrap gui/$(id -u) $PLIST"
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  fi
done

if [ "$APPLY" != "--apply" ]; then
  echo ""
  echo "DRY-RUN. Re-run with --apply to actually rewrite + reload."
fi

echo ""
echo "Verify with:"
echo "  launchctl list | grep com.conductor"
echo "  conductor pulse --json"

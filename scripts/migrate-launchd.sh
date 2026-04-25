#!/usr/bin/env bash
# scripts/migrate-launchd.sh
# Re-points conductor launchd jobs from old paths (conductor/, plugins/) to new caia/ paths.
# Run AFTER this PR merges + main is pulled locally.
#
# Usage:
#   bash scripts/migrate-launchd.sh           # dry-run, show plan
#   bash scripts/migrate-launchd.sh --apply   # actually rewrite + bootout/bootstrap
set -euo pipefail

CAIA_ROOT="${CAIA_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
APPLY="${1:-}"

echo "CAIA root: $CAIA_ROOT"
echo "Mode:      $([ "$APPLY" = "--apply" ] && echo APPLY || echo DRY-RUN)"
echo ""

# Step 1: ensure the daemons are actually built. The launchd plists point at dist/* artifacts.
echo "=== Step 1: build daemon apps ==="
( cd "$CAIA_ROOT" && pnpm --filter '@caia-app/core' --filter '@caia-app/completeness-sentinel' build )

# Plists to migrate. Format: label|old|new
PLAN=(
  "com.conductor.executor|/Users/MAC/Documents/projects/conductor/dist/src/cli/index.js|$CAIA_ROOT/apps/orchestrator/dist/src/cli/index.js"
  "com.conductor.completeness-sentinel|/Users/MAC/Documents/projects/plugins/completeness-sentinel/dist/daemon.cjs|$CAIA_ROOT/apps/completeness-sentinel/dist/daemon.cjs"
  "com.conductor.db-backup|/Users/MAC/Documents/projects/conductor/apps/db-backup/run-backup.sh|$CAIA_ROOT/apps/db-backup/run-backup.sh"
  "com.conductor.story-backfiller|/Users/MAC/Documents/projects/conductor/apps/story-backfiller/index.cjs|$CAIA_ROOT/apps/story-backfiller/index.cjs"
  "com.conductor.task-run-poller|/Users/MAC/Documents/projects/conductor/apps/task-run-poller/index.cjs|$CAIA_ROOT/apps/task-run-poller/index.cjs"
  "com.conductor.mcp|/Users/MAC/Documents/projects/conductor/dist/cli/index.js|$CAIA_ROOT/apps/orchestrator/dist/cli/index.js"
)

LAUNCHD_DIR="$HOME/Library/LaunchAgents"

echo ""
echo "=== Step 2: rewrite plists ==="
for entry in "${PLAN[@]}"; do
  IFS='|' read -r label OLD NEW <<<"$entry"
  PLIST="$LAUNCHD_DIR/$label.plist"

  if [ ! -f "$PLIST" ]; then
    echo "  [skip] $label — plist not present"
    continue
  fi

  if grep -q "$NEW" "$PLIST"; then
    echo "  [done] $label — already at $NEW"
    continue
  fi

  if ! grep -q "$OLD" "$PLIST"; then
    echo "  [warn] $label — old path not matched; skipping (manually review):"
    /usr/libexec/PlistBuddy -c "Print :ProgramArguments" "$PLIST" | sed 's/^/        /'
    continue
  fi

  if [ ! -f "$NEW" ]; then
    echo "  [warn] $label — target $NEW does not exist (build failed?); skipping"
    continue
  fi

  echo "  [rewrite] $label"
  echo "    OLD: $OLD"
  echo "    NEW: $NEW"

  if [ "$APPLY" = "--apply" ]; then
    cp "$PLIST" "$PLIST.bak.$(date +%Y%m%d-%H%M%S)"
    sed -i '' "s|$OLD|$NEW|g" "$PLIST"
    launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "    [applied + bootstrapped]"
  fi
done

echo ""
echo "=== Step 3: verify ==="
launchctl list | grep com.conductor || true
echo ""
if command -v conductor >/dev/null 2>&1; then
  echo "conductor pulse --json:"
  conductor pulse --json | head -10 || true
else
  echo "(conductor CLI not in PATH; run \`node $CAIA_ROOT/apps/orchestrator/dist/src/cli/index.js pulse --json\` to verify)"
fi

if [ "$APPLY" != "--apply" ]; then
  echo ""
  echo "DRY-RUN. Re-run with --apply to actually rewrite + reload."
fi

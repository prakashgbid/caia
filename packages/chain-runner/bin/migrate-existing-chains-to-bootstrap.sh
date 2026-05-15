#!/bin/bash
# H-47 (chain-runner-battle-harden phase 12, 2026-05-14). Migrate the
# pre-existing wake-script + runner-shell + plist trios for the three live
# chains into bootstrap-managed artifacts (rendered from
# packages/chain-runner/bin/templates/).
#
# Each chain's existing files are first backed up to
# ~/.caia/chain-watchdog/_pre_bootstrap_unification_backup/, then
# regenerated in place at their legacy paths via
# `caia-chain bootstrap-new-chain --force` with the override flags so
# filenames + log slugs match the historical convention.
#
# Safe to re-run: the backup directory is timestamped per invocation.

set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CAIA_CHAIN="$HERE/caia-chain.js"
NODE_BIN="${NODE_BIN:-/opt/homebrew/opt/node@22/bin/node}"
[ -x "$NODE_BIN" ] || NODE_BIN="/opt/homebrew/bin/node"

BACKUP_ROOT="$HOME/.caia/chain-watchdog/_pre_bootstrap_unification_backup/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$BACKUP_ROOT"

backup_file() {
  local src="$1"
  if [ -f "$src" ]; then
    cp -p "$src" "$BACKUP_ROOT/$(basename "$src")"
    echo "  backed up: $src -> $BACKUP_ROOT/"
  fi
}

migrate_chain() {
  local chain_id="$1"
  local label="$2"
  local log_slug="$3"
  local phases_yaml="$4"
  local schedule="$5"
  local wake_script="$6"
  local runner_script="$7"
  local plist="$8"
  local phase_log_dir="$9"

  echo "==> Migrating chain '${chain_id}' (label=${label}, slug=${log_slug})"
  backup_file "$wake_script"
  backup_file "$runner_script"
  backup_file "$plist"

  "$NODE_BIN" "$CAIA_CHAIN" bootstrap-new-chain \
    --label "$label" \
    --chain-id "$chain_id" \
    --phases "$phases_yaml" \
    --schedule "$schedule" \
    --no-bootstrap \
    --force \
    --log-slug "$log_slug" \
    --wake-script-out "$wake_script" \
    --runner-script-out "$runner_script" \
    --plist-out "$plist" \
    --phase-log-dir-out "$phase_log_dir"
  echo
}

# 1. chain-runner-battle-harden (this very chain).
migrate_chain \
  chain-runner-battle-harden \
  com.caia.chain-harden-wake \
  chain_harden \
  "$HOME/Documents/projects/agent-memory/chain_runner_battle_harden_phases.yaml" \
  '3,18,33,48 * * * *' \
  "$HOME/.caia/chain-watchdog/chain_harden_wake.sh" \
  "$HOME/Documents/projects/agent-memory/_chain_harden_run_phase.sh" \
  "$HOME/Library/LaunchAgents/com.caia.chain-harden-wake.plist" \
  "$HOME/Documents/projects/agent-memory/_chain_harden_phase_logs"

# 2. redflag-remediation (note: legacy plist label is `com.caia.redflag-wake`,
# not `com.caia.redflag-remediation-wake` — pre-dates the naming convention).
migrate_chain \
  redflag-remediation \
  com.caia.redflag-wake \
  redflag_remediation \
  "$HOME/Documents/projects/agent-memory/redflag_remediation_phases.yaml" \
  '*/15 * * * *' \
  "$HOME/.caia/chain-watchdog/redflag_remediation_wake.sh" \
  "$HOME/Documents/projects/agent-memory/_redflag_remediation_run_phase.sh" \
  "$HOME/Library/LaunchAgents/com.caia.redflag-wake.plist" \
  "$HOME/Documents/projects/agent-memory/_redflag_remediation_phase_logs"

# 3. apprentice-pull-forward.
migrate_chain \
  apprentice-pull-forward \
  com.caia.apprentice-pull-forward-wake \
  apprentice_pull_forward \
  "$HOME/Documents/projects/agent-memory/apprentice_pull_forward_phases.yaml" \
  '*/15 * * * *' \
  "$HOME/.caia/chain-watchdog/apprentice_pull_forward_wake.sh" \
  "$HOME/Documents/projects/agent-memory/_apprentice_pull_forward_run_phase.sh" \
  "$HOME/Library/LaunchAgents/com.caia.apprentice-pull-forward-wake.plist" \
  "$HOME/Documents/projects/agent-memory/_apprentice_pull_forward_phase_logs"

echo "Migration done."
echo "Originals saved at: $BACKUP_ROOT"
echo
echo "Next: verify the next cron tick fires without errors (tail ~/.caia/chain-watchdog/logs/*.log)."
echo "If anything misbehaves, restore an original with:"
echo "  cp $BACKUP_ROOT/<filename> <original-path>"

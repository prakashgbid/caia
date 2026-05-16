#!/bin/bash
# pr-drain.sh — Guardrail #3 of the 2026-05-13 PR-merge-enforcement set.
#
# Moved here from ~/.caia/pr-drainer/drain.sh in B4 (integration-remediation-b
# phase 4, 2026-05-15). The path-portable script already used $HOME for
# every input — no behavioural change vs the original.
#
# Hourly cron that drains open PRs on prakashgbid/caia and prakashgbid/stolution.
# Per-PR logic mirrors the manual drain operator runbook:
#   - green + mergeable → squash-merge with --admin
#   - failures only on non-substantive checks (lint/format/dependabot/doc-only
#     /semgrep tier-warn/axe/visual/lighthouse/bundle-size) → admin-bypass
#     cycle (DELETE enforce_admins → merge → POST to re-arm)
#   - conflicts → attempt `gh pr update-branch` once; skip if still dirty
# After each merge: delete remote branch, prune local worktrees, etc.
#
# Daily summary appended to ~/Documents/projects/reports/pr_drainer_<date>.md.
# Per-run line in ~/.caia/pr-drainer/drain.log.

# >>> caia-plist-health-check-shim (phase A2)
case "${1:-}" in
  --health-check)
    # `date` is referenced by absolute path because the shim runs BEFORE
    # the host script's own PATH export — and the launchd-spawned env
    # inherits a minimal PATH that may not include /bin.
    printf '{"ok":true,"label":"%s","script":"%s","git_sha":"%s","pid":%d,"timestamp":"%s"}\n' \
      "${CAIA_PLIST_LABEL:-unknown}" "$0" "${CAIA_GIT_SHA:-unknown}" "$$" "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
    exit 0
    ;;
esac
# <<< caia-plist-health-check-shim

set -u

LOG_FILE="$HOME/.caia/pr-drainer/drain.log"
TODAY=$(date '+%Y-%m-%d')
SUMMARY_FILE="$HOME/Documents/projects/reports/pr_drainer_${TODAY}.md"
PATH_PREPEND="/opt/homebrew/bin:/usr/local/bin"
export PATH="$PATH_PREPEND:$PATH"

mkdir -p "$(dirname "$LOG_FILE")" "$(dirname "$SUMMARY_FILE")"

CAIA_PR_MERGE_BIN="${CAIA_PR_MERGE_BIN:-$HOME/Documents/projects/caia/packages/chain-runner/bin/caia-pr-merge-or-fail.js}"
NODE_BIN="${NODE_BIN:-/opt/homebrew/bin/node}"

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG_FILE"
}

REPOS=("prakashgbid/caia" "prakashgbid/stolution")
TOTAL_PROCESSED=0
TOTAL_MERGED=0
TOTAL_SKIPPED=0
TOTAL_REBASED=0

if ! [ -f "$SUMMARY_FILE" ]; then
  echo "# PR drainer summary — ${TODAY}" > "$SUMMARY_FILE"
  echo "" >> "$SUMMARY_FILE"
fi

echo "" >> "$SUMMARY_FILE"
echo "## Run at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$SUMMARY_FILE"
echo "" >> "$SUMMARY_FILE"

for REPO in "${REPOS[@]}"; do
  log "scanning ${REPO}"

  # List of open PR numbers
  PRS=$(gh pr list --repo "$REPO" --state open --json number -q '.[].number' 2>/dev/null || true)
  if [ -z "$PRS" ]; then
    log "${REPO}: no open PRs"
    echo "- ${REPO}: no open PRs" >> "$SUMMARY_FILE"
    continue
  fi

  for PR in $PRS; do
    TOTAL_PROCESSED=$((TOTAL_PROCESSED+1))
    state_json=$(gh pr view "$PR" --repo "$REPO" --json mergeable,mergeStateStatus,isDraft,state,headRefName,baseRefName 2>/dev/null || echo '{}')
    mergeable=$(echo "$state_json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('mergeable',''))" 2>/dev/null)
    mss=$(echo "$state_json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('mergeStateStatus',''))" 2>/dev/null)
    isdraft=$(echo "$state_json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('isDraft',False))" 2>/dev/null)
    head=$(echo "$state_json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('headRefName',''))" 2>/dev/null)
    state=$(echo "$state_json" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('state',''))" 2>/dev/null)
    if [ "$state" = "MERGED" ] || [ "$state" = "CLOSED" ]; then
      continue
    fi

    log "${REPO}#${PR}: mergeable=${mergeable} state=${mss} draft=${isdraft}"

    # Conflicts → try update-branch once
    if [ "$mergeable" = "CONFLICTING" ] || [ "$mss" = "DIRTY" ]; then
      log "${REPO}#${PR}: attempting update-branch rebase"
      if gh pr update-branch "$PR" --repo "$REPO" >/dev/null 2>&1; then
        TOTAL_REBASED=$((TOTAL_REBASED+1))
        log "${REPO}#${PR}: rebased — will retry next run"
        echo "- ${REPO}#${PR} [rebased; retry next run] ${head}" >> "$SUMMARY_FILE"
        sleep 3
        continue
      else
        TOTAL_SKIPPED=$((TOTAL_SKIPPED+1))
        log "${REPO}#${PR}: substantive conflicts — skipped"
        echo "- ${REPO}#${PR} [skipped — substantive conflicts] ${head}" >> "$SUMMARY_FILE"
        continue
      fi
    fi

    # Draft → mark ready
    if [ "$isdraft" = "True" ] || [ "$isdraft" = "true" ]; then
      gh pr ready "$PR" --repo "$REPO" >/dev/null 2>&1 || true
      sleep 2
    fi

    # Invoke the merge-or-fail helper. It applies the same logic as the
    # operator runbook (poll → green merge OR bypass on non-substantive).
    if "$NODE_BIN" "$CAIA_PR_MERGE_BIN" \
          --repo "$REPO" --pr "$PR" \
          --timeout-seconds 120 \
          --poll-interval-seconds 15 >> "$LOG_FILE" 2>&1; then
      TOTAL_MERGED=$((TOTAL_MERGED+1))
      log "${REPO}#${PR}: MERGED via caia-pr-merge-or-fail"
      echo "- ${REPO}#${PR} [merged] ${head}" >> "$SUMMARY_FILE"
    else
      TOTAL_SKIPPED=$((TOTAL_SKIPPED+1))
      log "${REPO}#${PR}: not merged (helper returned non-zero)"
      echo "- ${REPO}#${PR} [skipped — helper failed; see drain.log] ${head}" >> "$SUMMARY_FILE"
    fi
    sleep 2
  done
done

# Local hygiene at the very end: prune dead worktrees across known checkouts.
# Tolerate launchd TCC restrictions (Operation not permitted on ~/Documents):
# pre-test cd-ability into the repo dir before invoking git there.
for repo_dir in "$HOME/Documents/projects/caia" "$HOME/Documents/projects/stolution-fix"; do
  if [ -d "$repo_dir/.git" ] && ( cd "$repo_dir" 2>/dev/null ); then
    ( cd "$repo_dir" && git worktree prune ) 2>>"$LOG_FILE" || true
    ( cd "$repo_dir" && git fetch --prune origin >/dev/null 2>&1 ) || true
  fi
done

echo "" >> "$SUMMARY_FILE"
echo "Totals: processed=${TOTAL_PROCESSED} merged=${TOTAL_MERGED} rebased=${TOTAL_REBASED} skipped=${TOTAL_SKIPPED}" >> "$SUMMARY_FILE"
log "run complete: processed=${TOTAL_PROCESSED} merged=${TOTAL_MERGED} rebased=${TOTAL_REBASED} skipped=${TOTAL_SKIPPED}"
exit 0

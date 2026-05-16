#!/bin/bash
# hygiene-audit.sh — Guardrail #6 of the 2026-05-13 PR-merge-enforcement set.
#
# Moved here from ~/.caia/hygiene/audit.sh in B4 (integration-remediation-b
# phase 4, 2026-05-15). The path-portable script already used $HOME for
# every input — no behavioural change vs the original.
#
# Daily 02:00 audit of git repository hygiene. Looks for drift across:
#   - stashes (alert if non-empty)
#   - worktrees (alert on orphans)
#   - open PRs older than 24h
#   - local branches without a remote (cleanup candidates)
#   - untracked files in main worktrees
#   - launchd plist load drift (declared but not loaded)
#
# Writes ~/Documents/projects/reports/git_hygiene_<date>.md and, if anything
# drifted, appends a one-line entry to ~/Documents/projects/agent-memory/INBOX.md.

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
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

TODAY=$(date '+%Y-%m-%d')
REPORT="$HOME/Documents/projects/reports/git_hygiene_${TODAY}.md"
INBOX="$HOME/Documents/projects/agent-memory/INBOX.md"
LOG="$HOME/.caia/hygiene/audit.log"

mkdir -p "$(dirname "$REPORT")" "$(dirname "$LOG")"

REPOS=(
  "$HOME/Documents/projects/caia"
  "$HOME/Documents/projects/stolution-fix"
  "$HOME/Documents/projects/agent-memory"
)
REMOTE_REPOS=("prakashgbid/caia" "prakashgbid/stolution")

DRIFT_FOUND=0

log() {
  printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >> "$LOG"
}

echo "# Git hygiene audit — ${TODAY}" > "$REPORT"
echo "" >> "$REPORT"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$REPORT"
echo "" >> "$REPORT"

log "audit start"

# 1) Local repo hygiene
for repo_dir in "${REPOS[@]}"; do
  if ! [ -d "$repo_dir/.git" ]; then continue; fi
  if ! ( cd "$repo_dir" 2>/dev/null ); then
    log "${repo_dir}: cwd unreadable (TCC)"; continue
  fi

  echo "" >> "$REPORT"
  echo "## ${repo_dir}" >> "$REPORT"
  echo "" >> "$REPORT"

  # Stashes
  stash_count=$(( cd "$repo_dir" && git stash list 2>/dev/null | wc -l ) | tr -d ' ')
  if [ "$stash_count" -gt 0 ]; then
    DRIFT_FOUND=1
    echo "- Stashes: **${stash_count} non-empty**" >> "$REPORT"
    ( cd "$repo_dir" && git stash list 2>/dev/null ) | sed 's/^/    /' >> "$REPORT"
  else
    echo "- Stashes: empty" >> "$REPORT"
  fi

  # Worktrees
  wt_lines=$( ( cd "$repo_dir" && git worktree list 2>/dev/null ) | wc -l | tr -d ' ')
  if [ "$wt_lines" -gt 1 ]; then
    echo "- Worktrees (${wt_lines} entries):" >> "$REPORT"
    ( cd "$repo_dir" && git worktree list 2>/dev/null ) | sed 's/^/    /' >> "$REPORT"
    # Check for prunable worktrees (missing dirs)
    prune_dry=$( ( cd "$repo_dir" && git worktree prune --dry-run --verbose 2>/dev/null ) | wc -l | tr -d ' ')
    if [ "$prune_dry" -gt 0 ]; then
      DRIFT_FOUND=1
      echo "- **Prunable worktrees found** (${prune_dry})" >> "$REPORT"
    fi
  fi

  # Local branches without an upstream
  no_upstream=$( ( cd "$repo_dir" && git for-each-ref --format='%(refname:short) %(upstream)' refs/heads/ 2>/dev/null | awk '$2 == "" {print $1}' ) || true)
  if [ -n "$no_upstream" ]; then
    DRIFT_FOUND=1
    echo "- **Local branches without upstream:**" >> "$REPORT"
    echo "$no_upstream" | sed 's/^/    /' >> "$REPORT"
  fi

  # Untracked files in working tree
  untracked=$( ( cd "$repo_dir" && git status --porcelain 2>/dev/null | grep -c '^??' ) || echo 0)
  if [ "$untracked" -gt 0 ]; then
    echo "- Untracked files in working tree: ${untracked}" >> "$REPORT"
  fi
done

# 2) Remote PRs older than 24h
echo "" >> "$REPORT"
echo "## Open PRs older than 24h" >> "$REPORT"
echo "" >> "$REPORT"

OLD_PRS=0
for full in "${REMOTE_REPOS[@]}"; do
  cutoff_iso=$(python3 -c "import datetime;print((datetime.datetime.utcnow()-datetime.timedelta(hours=24)).strftime('%Y-%m-%dT%H:%M:%SZ'))" 2>/dev/null || echo "")
  out=$(gh pr list --repo "$full" --state open --json number,title,createdAt --limit 100 2>/dev/null \
        | python3 -c "
import sys,json
cutoff='$cutoff_iso'
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(0)
hits=[p for p in d if p.get('createdAt','') < cutoff]
for p in hits:
    print('- {}#{}: {} (created {})'.format('$full', p['number'], p['title'][:80], p.get('createdAt','')))
print('__count__', len(hits))
" 2>/dev/null || true)
  count=$(echo "$out" | grep '^__count__' | awk '{print $2}')
  body=$(echo "$out" | grep -v '^__count__' || true)
  if [ -n "$body" ]; then
    echo "$body" >> "$REPORT"
  fi
  if [ -n "$count" ] && [ "$count" -gt 0 ]; then
    OLD_PRS=$((OLD_PRS + count))
    DRIFT_FOUND=1
  fi
done

echo "" >> "$REPORT"
echo "Total open PRs >24h: ${OLD_PRS}" >> "$REPORT"
log "audit complete: drift=${DRIFT_FOUND} old_prs=${OLD_PRS}"

# 3) Plist load audit
#    Catches the silent-unload failure mode: a plist file lives on disk in
#    ~/Library/LaunchAgents/ but its label is no longer registered with
#    launchd. Symptoms: scheduled jobs never run again until somebody notices.
#    For each declared plist, run `launchctl print gui/<uid>/<label>` and
#    treat non-zero exit as drift. Report numbers + drifted labels.
PLIST_DECLARED=0
PLIST_LOADED=0
PLIST_DRIFTED=0
PLIST_DRIFT_LABELS=""
UID_NUM=$(id -u)

echo "" >> "$REPORT"
echo "## Plist load audit" >> "$REPORT"
echo "" >> "$REPORT"

for plist in "$HOME/Library/LaunchAgents/"com.caia.*.plist \
             "$HOME/Library/LaunchAgents/"com.chiefaia.*.plist; do
  [ -f "$plist" ] || continue
  label=$(/usr/libexec/PlistBuddy -c "Print :Label" "$plist" 2>/dev/null)
  if [ -z "$label" ]; then continue; fi
  PLIST_DECLARED=$((PLIST_DECLARED + 1))
  if /bin/launchctl print "gui/${UID_NUM}/${label}" >/dev/null 2>&1; then
    PLIST_LOADED=$((PLIST_LOADED + 1))
  else
    PLIST_DRIFTED=$((PLIST_DRIFTED + 1))
    PLIST_DRIFT_LABELS="${PLIST_DRIFT_LABELS}${label} "
    DRIFT_FOUND=1
    audit_ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "- DRIFT: \`${label}\` (on disk but not loaded)" >> "$REPORT"
    if [ -f "$INBOX" ] && ( cd "$(dirname "$INBOX")" 2>/dev/null ); then
      echo "- PLIST DRIFT: ${label} on disk but not loaded (audit at ${audit_ts})" >> "$INBOX"
    fi
    log "plist drift: ${label}"
  fi
done

PLIST_SUMMARY="plist audit: ${PLIST_DECLARED} declared / ${PLIST_LOADED} loaded / ${PLIST_DRIFTED} drifted"
echo "" >> "$REPORT"
echo "${PLIST_SUMMARY}" >> "$REPORT"
echo "${PLIST_SUMMARY}"
log "${PLIST_SUMMARY}"

# 4) Inbox alert if drift found
if [ "$DRIFT_FOUND" = "1" ]; then
  if [ -f "$INBOX" ] && ( cd "$(dirname "$INBOX")" 2>/dev/null ); then
    echo "- ${TODAY} git-hygiene: drift detected — see $REPORT (old_prs=${OLD_PRS}, plist_drift=${PLIST_DRIFTED})" >> "$INBOX"
  fi
fi

exit 0

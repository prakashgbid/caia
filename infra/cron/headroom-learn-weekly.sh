#!/bin/bash
# headroom-learn-weekly.sh
#
# Weekly run of `headroom learn` to extract failure-mode corrections from
# the previous week's spawner-claude / Claude Code sessions, then write a
# readable markdown report into ~/Documents/projects/reports/.
#
# Closes A.9.17 / GC-5 from the SPS-Prompting #2 priority campaign.
#
# Triggered by ~/Library/LaunchAgents/com.chiefaia.headroom-learn-weekly.plist
# (Sundays, off-hours).
#
# At runtime this lives at ~/.caia/headroom-learn/learn.sh — the canonical
# copy is committed to caia/infra/cron/. Install with:
#   mkdir -p ~/.caia/headroom-learn
#   cp infra/cron/headroom-learn-weekly.sh ~/.caia/headroom-learn/learn.sh
#   chmod +x ~/.caia/headroom-learn/learn.sh
#   cp infra/cron/headroom-learn-weekly.plist ~/Library/LaunchAgents/com.chiefaia.headroom-learn-weekly.plist
#   launchctl bootstrap gui/$UID ~/Library/LaunchAgents/com.chiefaia.headroom-learn-weekly.plist

set -uo pipefail

# Resolve paths
HOME_DIR="${HOME:-/Users/macbook32}"
HEADROOM_BIN="${HEADROOM_BIN:-/opt/homebrew/bin/headroom}"
REPORT_DIR="${REPORT_DIR:-$HOME_DIR/Documents/projects/reports}"
LOG_DIR="${LOG_DIR:-$HOME_DIR/.caia/headroom-learn}"
DATE_UTC=$(date -u +%Y-%m-%d)
TS_UTC=$(date -u +%Y-%m-%dT%H:%M:%SZ)
REPORT_PATH="$REPORT_DIR/headroom_learn_weekly_${DATE_UTC}.md"
RUN_LOG="$LOG_DIR/run-${DATE_UTC}.log"
DRY_OUT="$LOG_DIR/dry-run-${DATE_UTC}.txt"
APPLY_OUT="$LOG_DIR/apply-${DATE_UTC}.txt"

mkdir -p "$LOG_DIR" "$REPORT_DIR"

echo "[$TS_UTC] starting headroom learn weekly run" | tee -a "$RUN_LOG"

if [ ! -x "$HEADROOM_BIN" ]; then
  echo "[FATAL] headroom binary not found at $HEADROOM_BIN" | tee -a "$RUN_LOG" >&2
  exit 2
fi

HR_VERSION=$("$HEADROOM_BIN" --version 2>&1 | head -1 || echo "unknown")
echo "[*] headroom version: $HR_VERSION" | tee -a "$RUN_LOG"

# Capture the size of CLAUDE.md before apply (for diff in report)
CLAUDE_MD="$HOME_DIR/Documents/CLAUDE.md"
SIZE_BEFORE=0
if [ -f "$CLAUDE_MD" ]; then
  SIZE_BEFORE=$(wc -c < "$CLAUDE_MD")
fi

# Phase 1 — dry-run to capture recommendations for the report
echo "[*] phase 1: dry-run scan of all projects" | tee -a "$RUN_LOG"
"$HEADROOM_BIN" learn --all --agent claude > "$DRY_OUT" 2>&1
DRY_RC=$?
echo "[*] dry-run rc=$DRY_RC, $(wc -l < "$DRY_OUT") lines captured" | tee -a "$RUN_LOG"

# Phase 2 — apply to write recommendations into context/memory files
echo "[*] phase 2: apply recommendations" | tee -a "$RUN_LOG"
"$HEADROOM_BIN" learn --all --agent claude --apply > "$APPLY_OUT" 2>&1
APPLY_RC=$?
echo "[*] apply rc=$APPLY_RC" | tee -a "$RUN_LOG"

SIZE_AFTER=0
if [ -f "$CLAUDE_MD" ]; then
  SIZE_AFTER=$(wc -c < "$CLAUDE_MD")
fi
SIZE_DELTA=$((SIZE_AFTER - SIZE_BEFORE))

# Phase 3 — write report
{
  echo "---"
  echo "name: Headroom Learn Weekly Report — ${DATE_UTC}"
  echo "type: cron-report"
  echo "agent: headroom-learn-weekly"
  echo "ts_utc: ${TS_UTC}"
  echo "---"
  echo
  echo "# Headroom Learn Weekly Report — ${DATE_UTC}"
  echo
  echo "Automated by \`com.chiefaia.headroom-learn-weekly\` LaunchAgent."
  echo "Source: A.9.17 / GC-5 from the SPS-Prompting #2 priority campaign."
  echo
  echo "## Run summary"
  echo
  echo "| Field | Value |"
  echo "|---|---|"
  echo "| Run timestamp | \`${TS_UTC}\` |"
  echo "| Headroom version | \`${HR_VERSION}\` |"
  echo "| Dry-run exit code | \`${DRY_RC}\` |"
  echo "| Apply exit code | \`${APPLY_RC}\` |"
  echo "| CLAUDE.md size before | ${SIZE_BEFORE} B |"
  echo "| CLAUDE.md size after | ${SIZE_AFTER} B |"
  echo "| CLAUDE.md size delta | ${SIZE_DELTA} B |"
  echo "| Run log | \`${RUN_LOG}\` |"
  echo "| Dry-run output | \`${DRY_OUT}\` |"
  echo "| Apply output | \`${APPLY_OUT}\` |"
  echo
  echo "## Dry-run recommendations"
  echo
  echo "\`headroom learn --all --agent claude\` (dry-run):"
  echo
  echo '```'
  head -200 "$DRY_OUT"
  echo '```'
  if [ "$(wc -l < "$DRY_OUT")" -gt 200 ]; then
    echo
    echo "_(truncated after 200 lines; full output at \`${DRY_OUT}\`)_"
  fi
  echo
  echo "## Apply output"
  echo
  echo '```'
  head -200 "$APPLY_OUT"
  echo '```'
  if [ "$(wc -l < "$APPLY_OUT")" -gt 200 ]; then
    echo
    echo "_(truncated after 200 lines; full output at \`${APPLY_OUT}\`)_"
  fi
  echo
  echo "## Next steps"
  echo
  echo "- Review changes to CLAUDE.md and per-project memory files (\`git diff\` if tracked)."
  echo "- If recommendations look noisy, edit \`~/.caia/headroom-learn/learn.sh\` to narrow \`--project\` or \`--agent\`."
  echo "- Next scheduled run: next Sunday 03:00 local."
} > "$REPORT_PATH"

echo "[*] report written: $REPORT_PATH" | tee -a "$RUN_LOG"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] done (dry_rc=$DRY_RC apply_rc=$APPLY_RC)" | tee -a "$RUN_LOG"

# Exit non-zero only when both phases failed — we still want a report on partial success.
if [ "$DRY_RC" -ne 0 ] && [ "$APPLY_RC" -ne 0 ]; then
  exit 1
fi
exit 0

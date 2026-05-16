#!/usr/bin/env bash
#
# heartbeat-auditor.sh — runs hourly via cron / LaunchAgent. Pure local.
# Computes "did anything happen this hour?" using the poller log and the
# spawn log. If silent, sets the audit-anomaly marker. Zero Claude tokens.
#
# What "anomaly" means:
#   1. running_count_ema dropped below 1.0 for the entire hour
#   2. spawn_queue had items but none were dispatched (thin spawner failed)
#   3. no Claude session created any new jsonl in the last hour AND running
#      count > 0 (sessions stuck — probably context-rotted)
#
# When anomaly fires, write to ~/.cache/orchestrator/audit_anomaly with
# context. The thin Claude alerter (separate scheduled task) reads the file
# on its next run and posts to the operator.

set -euo pipefail

CACHE="${HOME}/.cache/orchestrator"
LOG="$CACHE/poller_log.tsv"

if [[ ! -f "$LOG" ]]; then
  exit 0
fi

# Read the last 60 minutes of poller samples (one per minute).
NOW=$(date -u +%s)
SIXTY_MIN_AGO=$((NOW - 3600))

anomalies=()

# Anomaly 1: ema < 1.0 for entire hour.
ema_max=$(awk -v cutoff="$SIXTY_MIN_AGO" '
  {
    cmd = "date -u -d \"" $1 "\" +%s 2>/dev/null"
    cmd | getline ts; close(cmd)
    if (ts >= cutoff && $3+0 > max) max = $3+0
  }
  END { print max+0 }
' "$LOG")
if (( $(awk "BEGIN{print ($ema_max < 1.0)}") == 1 )); then
  anomalies+=("ema_below_1.0_for_full_hour:max=$ema_max")
fi

# Anomaly 2: spawn_queue stale.
SPAWN_QUEUE="$CACHE/spawn_queue"
if [[ -s "$SPAWN_QUEUE" ]]; then
  qmtime=$(stat -f %m "$SPAWN_QUEUE" 2>/dev/null || stat -c %Y "$SPAWN_QUEUE" 2>/dev/null || echo "$NOW")
  age=$((NOW - qmtime))
  if (( age > 1800 )); then  # > 30 minutes
    anomalies+=("spawn_queue_stale:items=$(wc -l < $SPAWN_QUEUE):age_seconds=$age")
  fi
fi

# Anomaly 3: running > 0 but no jsonl writes in the last hour (sessions
# stuck / context-rotted / deadlocked).
new_jsonls=0
for d in \
    "${HOME}/Library/Application Support/Claude/local-agent-mode-sessions" \
    "${HOME}/.claude/projects" ; do
  [[ -d "$d" ]] || continue
  count=$(find "$d" -type f -name '*.jsonl' -mmin -60 2>/dev/null | wc -l)
  new_jsonls=$((new_jsonls + count))
done
running=$(cat "$CACHE/running_count" 2>/dev/null || echo "0")
if (( running > 0 && new_jsonls == 0 )); then
  anomalies+=("sessions_present_but_idle:running=$running:new_jsonls=$new_jsonls")
fi

# Write anomaly marker (or clear it).
if (( ${#anomalies[@]} > 0 )); then
  printf '{\n  "ts": "%s",\n  "anomalies": [\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    > "$CACHE/audit_anomaly"
  for i in "${!anomalies[@]}"; do
    sep=","
    (( i == ${#anomalies[@]} - 1 )) && sep=""
    printf '    "%s"%s\n' "${anomalies[$i]}" "$sep" >> "$CACHE/audit_anomaly"
  done
  printf '  ]\n}\n' >> "$CACHE/audit_anomaly"
else
  rm -f "$CACHE/audit_anomaly"
fi

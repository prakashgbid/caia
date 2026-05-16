#!/usr/bin/env bash
#
# idle-detector.sh — local watchdog that fires when the system has been idle
# for too long. Reads state written by local-poller.sh; takes action via
# (a) the spawn queue (instructs the thin Claude spawner to spawn next item)
# and (b) a notification marker (instructs the thin Claude alerter to post a
# proactive SendUserMessage).
#
# Schedule: cron */1 * * * * on Mac (LaunchAgent) and stolution.
# Runs in <1 second. ZERO Claude tokens.

set -euo pipefail

CACHE="${HOME}/.cache/orchestrator"
RUNNING=$(cat "$CACHE/running_count" 2>/dev/null || echo "0")
ZERO_STREAK=$(cat "$CACHE/running_zero_streak" 2>/dev/null || echo "0")

# Threshold: 5 minutes of zero count → definitely idle, raise alarm.
# The Backlog Driver may have already enqueued, so we check.
SPAWN_QUEUE="$CACHE/spawn_queue"
ALARM="$CACHE/idle_alarm"
NOTIFY="$CACHE/idle_notify_pending"

touch "$SPAWN_QUEUE"

if (( ZERO_STREAK >= 5 )); then
  # 1) Make sure there's something queued to spawn.
  if [[ ! -s "$SPAWN_QUEUE" ]]; then
    next=$(./pick-next-backlog-item.sh 2>/dev/null || echo "")
    if [[ -n "$next" ]]; then
      echo "$next" >> "$SPAWN_QUEUE"
    fi
  fi

  # 2) Set the notify-pending marker so the thin alerter posts to operator
  #    on its next tick (and only on the FIRST tick — the marker is removed
  #    once posted).
  if [[ ! -f "$NOTIFY" ]]; then
    cat > "$NOTIFY" <<EOF
{
  "kind": "idle_alarm",
  "running_count": $RUNNING,
  "zero_streak_minutes": $ZERO_STREAK,
  "queued_spawn": "$(head -n1 $SPAWN_QUEUE 2>/dev/null || echo none)",
  "ts": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  fi
fi

# 3) If we're back to running > 0 AND there was a previous alarm, clear
#    everything.
if (( RUNNING > 0 )) && [[ -f "$ALARM" ]]; then
  rm -f "$ALARM" "$NOTIFY"
fi

exit 0

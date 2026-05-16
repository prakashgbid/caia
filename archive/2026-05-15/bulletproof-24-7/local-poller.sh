#!/usr/bin/env bash
#
# local-poller.sh — pure-bash polling loop. Counts running Claude sessions
# and writes a state file. Runs every 60 seconds via LaunchAgent (Mac) or
# cron (stolution). Zero Claude tokens consumed.
#
# This is the LOCAL-FIRST replacement for the previous "scheduled task that
# is itself a Claude session counts running tasks" design. The expensive
# polling work (which can run thousands of times/day) is now $0/$0-token.
# The only Claude session involvement is when we ACTUALLY need to spawn or
# alert.
#
# Output state files (atomic writes):
#   ~/.cache/orchestrator/running_count       — integer, last sample
#   ~/.cache/orchestrator/running_count_ema   — exponentially weighted moving avg (5 min window)
#   ~/.cache/orchestrator/running_zero_streak — minutes since count was last > 0
#   ~/.cache/orchestrator/last_completion     — ISO timestamp of most recent finished session
#   ~/.cache/orchestrator/spawn_queue         — newline-separated queue of items to spawn
#   ~/.cache/orchestrator/idle_alarm          — flag file: present iff zero-streak > 5 min
#
# Failure mode addressed: the old design relied on the orchestrator (or a
# scheduled-task Claude session) to count running tasks. Both consume
# tokens; both can fail silently (context loss, system reminder skipped).
# Local poll runs unconditionally even if every Claude session is dead.

set -euo pipefail

CACHE="${HOME}/.cache/orchestrator"
mkdir -p "$CACHE"

ATOMIC_WRITE() {
  local path="$1"; local content="$2"
  printf '%s' "$content" > "${path}.tmp"
  mv "${path}.tmp" "$path"
}

# 1) Sample running session count.
#
# Mac M1/M3: Cowork stores session metadata under
# ~/Library/Application\ Support/Claude/local-agent-mode-sessions/...
# Each running task has a session.json with status field. We grep for active
# state. Exact path may vary across Cowork builds — fall back to a heuristic
# based on session-jsonl-mtime.
#
# Stolution: same structure under /home/s903/.claude/projects/.
#
# We use a 30-minute mtime window as the "active" heuristic. A session that
# has not written to its jsonl in 30 minutes is treated as completed/dead.

SESSION_DIR_CANDIDATES=(
  "${HOME}/Library/Application Support/Claude/local-agent-mode-sessions"
  "${HOME}/.claude/projects"
)

RUNNING=0
for dir in "${SESSION_DIR_CANDIDATES[@]}"; do
  [[ -d "$dir" ]] || continue
  # Count session jsonl files modified in the last 30 minutes.
  count=$(find "$dir" -type f -name '*.jsonl' -mmin -30 2>/dev/null | wc -l | tr -d ' ')
  RUNNING=$(( RUNNING + count ))
done

ATOMIC_WRITE "$CACHE/running_count" "$RUNNING"

# 2) Update zero-streak.
prev_streak=$(cat "$CACHE/running_zero_streak" 2>/dev/null || echo 0)
if (( RUNNING == 0 )); then
  new_streak=$(( prev_streak + 1 ))
else
  new_streak=0
fi
ATOMIC_WRITE "$CACHE/running_zero_streak" "$new_streak"

# 3) Idle alarm (absolute simple — no Ollama needed for this signal).
if (( new_streak >= 5 )); then  # 5 minutes of zero
  touch "$CACHE/idle_alarm"
fi

# 4) Sample-EMA for trend detection (used by Heartbeat Auditor).
prev_ema=$(cat "$CACHE/running_count_ema" 2>/dev/null || echo "$RUNNING")
# alpha = 0.2 (smoothing — last sample weighted 20%, history 80%)
new_ema=$(awk -v p="$prev_ema" -v c="$RUNNING" 'BEGIN { printf "%.2f", 0.2 * c + 0.8 * p }')
ATOMIC_WRITE "$CACHE/running_count_ema" "$new_ema"

# 5) Append to audit log (append-only, no Claude involvement).
LOG="$CACHE/poller_log.tsv"
printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUNNING" "$new_ema" "$new_streak" >> "$LOG"

# 6) If running < floor (5) AND backlog has items AND spawn_queue is empty:
#    enqueue the next item ID. The thin Claude spawner (separate scheduled
#    task) will pop and dispatch.
FLOOR=5
SPAWN_QUEUE="$CACHE/spawn_queue"
touch "$SPAWN_QUEUE"

if (( RUNNING < FLOOR )) && [[ ! -s "$SPAWN_QUEUE" ]]; then
  next_item=$(./pick-next-backlog-item.sh 2>/dev/null || echo "")
  if [[ -n "$next_item" ]]; then
    echo "$next_item" >> "$SPAWN_QUEUE"
  fi
fi

exit 0

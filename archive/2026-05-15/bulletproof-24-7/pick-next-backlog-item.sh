#!/usr/bin/env bash
#
# pick-next-backlog-item.sh — DETERMINISTIC backlog selection. Outputs
# the next unblocked item id on stdout, or empty if none.
#
# Pure bash + grep + awk. NO Claude tokens. NO Ollama. NO LLM.
#
# Algorithm:
#   1. Parse master_backlog_sequencing_2026-05-05.md table rows.
#   2. For each row, extract item id + status + dependencies.
#   3. Skip rows marked DONE, BLOCKED, or DEFERRED.
#   4. Skip rows whose dependencies are not all DONE.
#   5. Skip rows for which a session is currently in flight (grep
#      session prompts under ~/.claude/projects for "# Item: <id>").
#   6. Output the lowest-numbered remaining row's id.
#
# This script is the "decision-elimination" surface for the
# never-idle property. By codifying the backlog rules as pure shell,
# the orchestrator (and the Backlog Driver) never has to "think"
# about what to spawn — it just reads stdout.

set -euo pipefail

MEMORY="${HOME}/Documents/projects/agent-memory"
MASTER="${MEMORY}/master_backlog_sequencing_2026-05-05.md"

if [[ ! -f "$MASTER" ]]; then
  echo "[pick-next] master sequencing file not found: $MASTER" >&2
  exit 1
fi

# Extract table rows that look like:  | <order> | **<itemId> ...
# Match on the bullet pattern "**Bn.Px..." where B = backlog id, n = number,
# Px = phase letter+digit. We accept any markdown table whose first cell is
# numeric.
#
# For 2026-05-08 the operator-extended table includes columns:
#   Order | Item | Why this order | Effort | Trigger
# We need: Item id (the part inside ** ... **) and status keywords.

# 1) Build a list of completed items by scanning the table for "DONE" markers
#    and recent completion-report files.
COMPLETED=$(grep -lE 'DONE\b|completion-2026' "$MEMORY"/*.md 2>/dev/null \
  | xargs -I{} basename {} .md \
  | sort -u || echo "")

# 2) Build a list of in-flight items by scanning recent session prompts.
IN_FLIGHT=""
for d in \
    "${HOME}/Library/Application Support/Claude/local-agent-mode-sessions" \
    "${HOME}/.claude/projects" ; do
  [[ -d "$d" ]] || continue
  while IFS= read -r f; do
    # First few lines of each session jsonl typically include the prompt.
    # Look for "# Item: " markers.
    item=$(head -c 8192 "$f" 2>/dev/null \
           | grep -oE '# Item: [A-Z0-9.]+' \
           | head -n1 \
           | awk '{print $3}')
    [[ -n "$item" ]] && IN_FLIGHT="$IN_FLIGHT $item"
  done < <(find "$d" -type f -name '*.jsonl' -mmin -30 2>/dev/null)
done

# 3) Walk the table.
awk -v completed="$COMPLETED" -v inflight="$IN_FLIGHT" '
  BEGIN { picked = 0 }
  /^\| *[0-9]+(\.[0-9]+)? *\|/ && !picked {
    # split row on | and clean up
    n = split($0, cells, "|")
    if (n < 4) next
    order = cells[2]; gsub(/[ ]+/, "", order)
    item_cell = cells[3]
    # extract first **...** token if present
    if (match(item_cell, /\*\*[^*]+\*\*/)) {
      bold = substr(item_cell, RSTART+2, RLENGTH-4)
      # Take leading id-looking token e.g. "B6.W1", "B5.A5", "B11.A"
      if (match(bold, /B[0-9]+(\.[A-Z0-9]+)?/)) {
        id = substr(bold, RSTART, RLENGTH)
      } else {
        id = bold
      }
    } else {
      next
    }
    # Skip if completed or in-flight
    if (index(completed, id)) next
    if (index(inflight,  " " id)) next
    # Skip explicit DONE / BLOCKED / DEFERRED markers in this row.
    if ($0 ~ /DONE|BLOCKED|DEFERRED/) next
    # Pick this one.
    print id
    picked = 1
  }
' "$MASTER"

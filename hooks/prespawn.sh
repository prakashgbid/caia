#!/bin/bash
# Conductor pre-spawn hook
# Blocks task spawning when file conflicts exist

INPUT=$(cat)
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Only fire for dispatch spawn tools
case "$TOOL_NAME" in
  mcp__dispatch__start_task|mcp__dispatch__start_code_task) ;;
  *) exit 0 ;;
esac

# Check bypass
if [[ "${CLAUDE_CONDUCTOR_BYPASS:-0}" == "1" ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) BYPASS tool=$TOOL_NAME" >> ~/.conductor/degraded.log
  curl -sf -X POST http://localhost:7776/bypass -H "Content-Type: application/json" \
    -d "{\"tool\": \"$TOOL_NAME\"}" 2>/dev/null || true
  exit 0
fi

PROMPT=$(echo "$INPUT" | jq -r '.tool_input.prompt // .tool_input.description // empty' 2>/dev/null)
CWD=$(echo "$INPUT" | jq -r '.tool_input.cwd // empty' 2>/dev/null)
TITLE=$(echo "$INPUT" | jq -r '.tool_input.title // .tool_input.description // "Untitled task"' 2>/dev/null)

# Check for conductor declaration tag
if ! echo "$PROMPT" | grep -q '<conductor'; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "CONDUCTOR REQUIRED: Include a <conductor files=\"glob1,glob2\" depends_on=\"tsk_xxx\"/> tag in your task prompt declaring which files this task will touch. This prevents file-conflict races between parallel tasks."
  }
}
EOF
  exit 0
fi

# Parse files and depends_on from tag
FILES=$(echo "$PROMPT" | grep -oP '(?<=files=")[^"]*' | head -1)
DEPENDS=$(echo "$PROMPT" | grep -oP '(?<=depends_on=")[^"]*' | head -1)

# Check conductor health endpoint
HEALTH=$(curl -sf --max-time 5 http://localhost:7776/health 2>/dev/null)
if [[ $? -ne 0 ]]; then
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) DEGRADED_SPAWN tool=$TOOL_NAME files=$FILES" >> ~/.conductor/degraded.log
  exit 0
fi

# Check for conflicts
if [[ -n "$FILES" ]]; then
  FILE_ARRAY=$(echo "$FILES" | tr ',' '\n' | jq -R . | jq -s .)
  CONFLICT_RESULT=$(curl -sf --max-time 5 \
    -X POST http://localhost:7776/check \
    -H "Content-Type: application/json" \
    -d "{\"files\": $FILE_ARRAY}" 2>/dev/null)

  if [[ $? -eq 0 ]]; then
    CLEAN=$(echo "$CONFLICT_RESULT" | jq -r '.clean // true')
    if [[ "$CLEAN" == "false" ]]; then
      CONFLICTS=$(echo "$CONFLICT_RESULT" | jq -c '.conflicts')
      cat <<EOF
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "CONDUCTOR CONFLICT: Files are locked by other running tasks: $CONFLICTS. Wait for those tasks to complete or call conductor_complete/conductor_release to free the locks first."
  }
}
EOF
      exit 0
    fi
  fi
fi

# Register the task
DEPENDS_ARRAY="[]"
if [[ -n "$DEPENDS" ]]; then
  DEPENDS_ARRAY=$(echo "$DEPENDS" | tr ',' '\n' | jq -R . | jq -s .)
fi

FILE_ARRAY=$(echo "$FILES" | tr ',' '\n' | jq -R . | jq -s .)

ADD_RESULT=$(curl -sf --max-time 5 \
  -X POST http://localhost:7776/tasks \
  -H "Content-Type: application/json" \
  -d "{\"title\": $(echo "$TITLE" | jq -R .), \"cwd\": $(echo "${CWD:-$(pwd)}" | jq -R .), \"files\": $FILE_ARRAY, \"dependsOn\": $DEPENDS_ARRAY, \"spawnedBy\": \"hook\"}" 2>/dev/null)

if [[ $? -eq 0 ]]; then
  TASK_ID=$(echo "$ADD_RESULT" | jq -r '.id // empty')
  if [[ -n "$TASK_ID" ]]; then
    echo "conductor_task_id=$TASK_ID" >&2
  fi
fi

exit 0

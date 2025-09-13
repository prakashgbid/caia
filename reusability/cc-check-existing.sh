#!/bin/bash

# CC Check Existing - Quick command to check for existing implementations

TASK="$@"

if [ -z "$TASK" ]; then
  echo "Usage: cc-check-existing <task-description>"
  echo "Example: cc-check-existing authentication system"
  exit 1
fi

echo "🔍 Checking for existing implementation of: $TASK"
echo "============================================================"

# Use the CC Context Provider
node /Users/MAC/Documents/projects/caia/reusability/cc-context-provider.js check "$TASK"
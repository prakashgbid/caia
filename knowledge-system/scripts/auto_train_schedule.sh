#!/usr/bin/env bash
# Automatic CKS Training Scheduler
set -euo pipefail
IFS=$'\n\t'
# Configuration
CKS_ROOT="/Users/MAC/Documents/projects/caia/knowledge-system"
TRAIN_SCRIPT="$CKS_ROOT/scripts/train_cks_full.py"
LOG_FILE="$CKS_ROOT/logs/auto_train.log"

# Create logs directory if it doesn't exist
mkdir -p "$CKS_ROOT/logs"

# Function to run training
run_training() {
    echo "[$(date)] Starting scheduled CKS training..." >> "$LOG_FILE"
    python3 "$TRAIN_SCRIPT" >> "$LOG_FILE" 2>&1
    echo "[$(date)] Training completed" >> "$LOG_FILE"
    echo "---" >> "$LOG_FILE"
}

# Check if this should run as daemon or one-time
if [ "$1" == "daemon" ]; then
    echo "Starting CKS auto-training daemon (runs every 4 hours)"
    while true; do
        run_training
        sleep 14400  # 4 hours
    done
elif [ "$1" == "once" ]; then
    echo "Running one-time CKS training"
    run_training
    echo "Training complete. Check $LOG_FILE for details"
else
    echo "Usage: $0 [daemon|once]"
    echo "  daemon - Run training every 4 hours"
    echo "  once   - Run training once"
    exit 1
fi
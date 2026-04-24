#!/bin/bash
# Conductor daily DB backup — runs at 3am via launchd
set -euo pipefail

CONDUCTOR_DB="${CONDUCTOR_DB:-$HOME/.conductor/db.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-$HOME/Documents/conductor-backups}"
STATE_REPO="${STATE_REPO:-$HOME/Documents/projects/conductor-state}"
CONDUCTOR_API="${CONDUCTOR_API:-http://localhost:7776}"
DATE=$(date +"%Y%m%d-%H%M%S")
BACKUP_FILE="$BACKUP_DIR/db-$DATE.sqlite"

echo "[db-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) starting backup"

# Ensure backup dir exists
mkdir -p "$BACKUP_DIR"

# VACUUM INTO creates a clean, fully-vacuumed copy
sqlite3 "$CONDUCTOR_DB" "VACUUM INTO '$BACKUP_FILE';"
SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null || echo 0)
CHECKSUM=$(shasum -a 256 "$BACKUP_FILE" | awk '{print $1}')

echo "[db-backup] Backup written: $BACKUP_FILE ($SIZE bytes)"

# Get row counts per table
ROW_COUNTS=$(sqlite3 "$BACKUP_FILE" "
  SELECT json_object(
    'stories', (SELECT COUNT(*) FROM stories),
    'completeness_runs', (SELECT COUNT(*) FROM completeness_runs),
    'completeness_findings', (SELECT COUNT(*) FROM completeness_findings),
    'requirements', (SELECT COUNT(*) FROM requirements),
    'blockers', (SELECT COUNT(*) FROM blockers),
    'timeline_events', (SELECT COUNT(*) FROM timeline_events),
    'lock_contracts', (SELECT COUNT(*) FROM lock_contracts),
    'behavior_tests', (SELECT COUNT(*) FROM behavior_tests),
    'task_runs', (SELECT COUNT(*) FROM task_runs)
  );
" 2>/dev/null || echo '{}')

# Record in Conductor API
curl -s -X POST "$CONDUCTOR_API/db-backups" \
  -H "Content-Type: application/json" \
  -d "{\"path\":\"$BACKUP_FILE\",\"size_bytes\":$SIZE,\"row_counts\":$ROW_COUNTS,\"checksum\":\"$CHECKSUM\"}" \
  > /dev/null || echo "[db-backup] WARNING: could not record backup in Conductor API"

# JSONL dump to conductor-state repo
if [ -d "$STATE_REPO" ] || mkdir -p "$STATE_REPO"; then
  cd "$STATE_REPO"
  [ -d ".git" ] || git init -q
  DATE_DIR="$STATE_REPO/$DATE"
  mkdir -p "$DATE_DIR"

  # Dump each table to JSONL using sqlite3
  for TABLE in stories completeness_runs completeness_findings requirements blockers timeline_events lock_contracts behavior_tests task_runs; do
    sqlite3 "$CONDUCTOR_DB" -json "SELECT * FROM $TABLE LIMIT 100000;" 2>/dev/null \
      | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));d.forEach(r=>process.stdout.write(JSON.stringify(r)+'\n'));" \
      > "$DATE_DIR/$TABLE.jsonl" 2>/dev/null || echo "[]" > "$DATE_DIR/$TABLE.jsonl"
  done

  git add -A
  git diff --cached --quiet || git commit -q -m "backup: conductor state $DATE"
  echo "[db-backup] JSONL state committed to conductor-state repo"
fi

# Retain last 30 days; delete older (keep monthly snapshots on 1st of month)
find "$BACKUP_DIR" -name "db-*.sqlite" -mtime +30 | while IFS= read -r old; do
  base=$(basename "$old")
  # Keep if filename starts with YYYYMM01 (1st of month)
  day="${base:9:2}"
  if [ "$day" != "01" ]; then
    rm -f "$old"
    echo "[db-backup] Pruned: $old"
  fi
done

echo "[db-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) done"

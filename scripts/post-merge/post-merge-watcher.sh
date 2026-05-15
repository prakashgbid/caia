#!/usr/bin/env bash
# INT.1.A1 — Guardrail #7 post-merge deployment signal watcher.
#
# Polls the `post-merge-queue` orphan branch in each tracked repo, pops new
# rows since last seen, invokes `post-merge-deploy.sh` per row, records
# outcomes to `~/.caia/post-merge/log.jsonl`.
#
# Designed for `com.caia.post-merge-watcher` (StartInterval=60). Idempotent;
# safe to re-run.
#
# Tracked repos: edit POSTMERGE_REPOS to add more.

set -euo pipefail

POSTMERGE_HOME="${POSTMERGE_HOME:-$HOME/.caia/post-merge}"
POSTMERGE_REPOS="${POSTMERGE_REPOS:-prakashgbid/caia prakashgbid/stolution}"
POSTMERGE_DEPLOY="${POSTMERGE_DEPLOY:-$POSTMERGE_HOME/post-merge-deploy.sh}"
POSTMERGE_QUEUE_BRANCH="${POSTMERGE_QUEUE_BRANCH:-post-merge-queue}"
POSTMERGE_MAX_ROWS="${POSTMERGE_MAX_ROWS:-50}"

mkdir -p "$POSTMERGE_HOME" "$POSTMERGE_HOME/work" "$POSTMERGE_HOME/seen"
SEEN_FILE="$POSTMERGE_HOME/seen.jsonl"
LOG_FILE="$POSTMERGE_HOME/log.jsonl"
LOCK_FILE="$POSTMERGE_HOME/watcher.lock"
touch "$SEEN_FILE" "$LOG_FILE"

log_event() {
  local level="$1" event="$2" extra="${3:-}"
  local ts
  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -n "$extra" ]]; then
    printf '{"ts":"%s","level":"%s","event":"%s",%s}\n' "$ts" "$level" "$event" "$extra" >> "$LOG_FILE"
  else
    printf '{"ts":"%s","level":"%s","event":"%s"}\n' "$ts" "$level" "$event" >> "$LOG_FILE"
  fi
}

# --- health-check shortcut ---------------------------------------------------
if [[ "${1:-}" == "--health-check" ]]; then
  printf '{"ok":true,"name":"post-merge-watcher","home":"%s"}\n' "$POSTMERGE_HOME"
  exit 0
fi

# --- single-instance lock (flock if available, mkdir fallback) ---------------
acquire_lock() {
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$LOCK_FILE"
    if ! flock -n 9; then
      log_event info skip_already_running ""
      exit 0
    fi
  else
    if ! mkdir "$LOCK_FILE.d" 2>/dev/null; then
      log_event info skip_already_running ""
      exit 0
    fi
    trap 'rmdir "$LOCK_FILE.d" 2>/dev/null || true' EXIT
  fi
}
acquire_lock

if ! command -v gh >/dev/null 2>&1; then
  log_event error gh_missing ""
  exit 0
fi
if ! command -v jq >/dev/null 2>&1; then
  log_event error jq_missing ""
  exit 0
fi
if [[ ! -x "$POSTMERGE_DEPLOY" ]]; then
  log_event error deploy_script_missing "\"path\":\"$POSTMERGE_DEPLOY\""
  exit 0
fi

process_row() {
  local row="$1"
  local sha
  sha="$(printf '%s' "$row" | jq -r '.merge_sha // empty')"
  if [[ -z "$sha" || "$sha" == "null" ]]; then
    log_event warn row_missing_sha "\"row\":$(printf '%s' "$row" | jq -Rs .)"
    return 0
  fi
  if grep -F -q -- "$sha" "$SEEN_FILE" 2>/dev/null; then
    return 0
  fi
  log_event info dispatch "\"merge_sha\":\"$sha\""
  local rc=0
  "$POSTMERGE_DEPLOY" "$row" >> "$LOG_FILE" 2>&1 || rc=$?
  printf '%s\n' "$row" >> "$SEEN_FILE"
  log_event info dispatch_done "\"merge_sha\":\"$sha\",\"rc\":$rc"
}

for repo in $POSTMERGE_REPOS; do
  repo_safe="${repo//\//__}"
  raw_url="repos/${repo}/contents/queue.jsonl?ref=${POSTMERGE_QUEUE_BRANCH}"
  tmp_queue="$POSTMERGE_HOME/work/${repo_safe}.queue.jsonl"
  if ! gh api "$raw_url" -H "Accept: application/vnd.github.raw" > "$tmp_queue.new" 2>"$tmp_queue.err"; then
    if grep -q "Not Found\|404" "$tmp_queue.err" 2>/dev/null; then
      # Branch or file not yet created — first merge hasn't fired.
      :
    else
      log_event warn fetch_failed "\"repo\":\"$repo\",\"err\":$(jq -Rs . < "$tmp_queue.err")"
    fi
    rm -f "$tmp_queue.new" "$tmp_queue.err"
    continue
  fi
  rm -f "$tmp_queue.err"
  mv "$tmp_queue.new" "$tmp_queue"

  rows_processed=0
  while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    process_row "$row"
    rows_processed=$((rows_processed + 1))
    if (( rows_processed >= POSTMERGE_MAX_ROWS )); then
      log_event info batch_cap_reached "\"repo\":\"$repo\",\"cap\":$POSTMERGE_MAX_ROWS"
      break
    fi
  done < "$tmp_queue"
done

log_event info tick_done ""

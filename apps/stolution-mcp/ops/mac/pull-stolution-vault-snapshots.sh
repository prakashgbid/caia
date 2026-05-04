#!/bin/bash
# =============================================================================
# pull-stolution-vault-snapshots.sh
#
# Pulls Vault Raft snapshots from the stolution server to local Mac storage.
# Mac-side counterpart of the stolution-side daily snapshot cron — gives us an
# off-server copy of every secret-store snapshot so a server-disk failure can't
# wipe the only backups.
#
# Server-side flow:
#   02:00 — vault Raft snapshot taken on stolution -> ~/backups/vault/
#   02:05 — audit log rotated on stolution
#
# Mac-side flow (this script):
#   03:30 — rsync ~/backups/vault/*.snap from stolution -> local
#         — prune local snapshots older than RETAIN_DAYS
#         — verify newest snapshot < MAX_AGE_HOURS old; exit non-zero if not
#
# Idempotent. Safe to run on demand.
# =============================================================================

set -uo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────

readonly REMOTE_SSH_ALIAS="${STOLUTION_SSH_ALIAS:-stolution}"
readonly REMOTE_SNAP_DIR="${REMOTE_SNAP_DIR:-/home/s903/backups/vault}"
readonly LOCAL_SNAP_DIR="${LOCAL_SNAP_DIR:-${HOME}/Library/Application Support/Stolution/vault-snapshots}"
readonly LOG_FILE="${LOG_FILE:-${HOME}/Library/Logs/stolution-vault-snapshot-pull.log}"
readonly RETAIN_DAYS="${RETAIN_DAYS:-30}"
readonly MAX_AGE_HOURS="${MAX_AGE_HOURS:-26}"

# Optional external-disk mirror. Set EXTERNAL_MIRROR_DIR to enable. Mirror runs
# only if today is the configured weekday (default Sunday=0). If the path is
# unset OR the mount is offline, mirror step is silently skipped.
# TODO: configure once an external/Time Machine drive path is decided.
readonly EXTERNAL_MIRROR_DIR="${EXTERNAL_MIRROR_DIR:-}"
readonly EXTERNAL_MIRROR_WEEKDAY="${EXTERNAL_MIRROR_WEEKDAY:-0}"  # 0=Sunday

# ─── Logging ──────────────────────────────────────────────────────────────────

mkdir -p "$(dirname "$LOG_FILE")"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S%z')" "$*" >> "$LOG_FILE"
}

fail() {
  log "FAIL: $*"
  echo "FAIL: $*" >&2
  exit 1
}

log "=== run start (pid=$$) ==="

# ─── Pre-flight ───────────────────────────────────────────────────────────────

# Verify SSH alias works without prompting. BatchMode=yes forces non-interactive;
# any password / fingerprint / key prompt becomes an immediate failure.
if ! ssh -o BatchMode=yes -o ConnectTimeout=10 "$REMOTE_SSH_ALIAS" 'echo ok' >/dev/null 2>&1; then
  fail "ssh alias '$REMOTE_SSH_ALIAS' failed (non-interactive). Check ~/.ssh/config and key auth."
fi

mkdir -p "$LOCAL_SNAP_DIR" || fail "cannot create $LOCAL_SNAP_DIR"

# ─── Pull ─────────────────────────────────────────────────────────────────────

log "rsync ${REMOTE_SSH_ALIAS}:${REMOTE_SNAP_DIR}/ -> ${LOCAL_SNAP_DIR}/"

# Sync only snapshot files, never anything else (e.g. README.md).
# --partial-dir keeps a half-pull resumable; --timeout protects against hangs.
if ! rsync -az \
    --include='vault-snapshot-*.snap' \
    --exclude='*' \
    --partial \
    --timeout=120 \
    "${REMOTE_SSH_ALIAS}:${REMOTE_SNAP_DIR}/" \
    "${LOCAL_SNAP_DIR}/" \
    >> "$LOG_FILE" 2>&1
then
  fail "rsync failed (see ${LOG_FILE})"
fi

# ─── Prune ────────────────────────────────────────────────────────────────────

log "pruning local snapshots older than ${RETAIN_DAYS} days"
# -mtime +N matches files whose mtime is > N days. Use -print to log names,
# then a separate -delete for clarity in logs.
to_prune="$(find "$LOCAL_SNAP_DIR" -type f -name 'vault-snapshot-*.snap' -mtime "+${RETAIN_DAYS}" -print 2>/dev/null || true)"
if [[ -n "$to_prune" ]]; then
  echo "$to_prune" | while IFS= read -r f; do log "  pruning $(basename "$f")"; done
  find "$LOCAL_SNAP_DIR" -type f -name 'vault-snapshot-*.snap' -mtime "+${RETAIN_DAYS}" -delete 2>/dev/null || true
else
  log "  nothing to prune"
fi

# ─── Verify ───────────────────────────────────────────────────────────────────

count="$(find "$LOCAL_SNAP_DIR" -maxdepth 1 -type f -name 'vault-snapshot-*.snap' | wc -l | tr -d ' ')"
log "local snapshot count: ${count}"
if [[ "$count" -eq 0 ]]; then
  fail "no local snapshots after rsync — pull is empty"
fi

# Newest snapshot age. -t sorts by mtime (newest first); we use stat -f to get
# the mtime as a unix timestamp (BSD/macOS stat — different flag from GNU stat).
newest="$(find "$LOCAL_SNAP_DIR" -maxdepth 1 -type f -name 'vault-snapshot-*.snap' -print0 \
            | xargs -0 stat -f '%m %N' 2>/dev/null | sort -nr | head -1)"
newest_path="${newest#* }"
newest_mtime="${newest%% *}"
now="$(date +%s)"
age_seconds=$(( now - newest_mtime ))
age_hours=$(( age_seconds / 3600 ))

log "newest snapshot: $(basename "$newest_path") — mtime $(date -r "$newest_mtime" '+%Y-%m-%d %H:%M:%S%z') — age ${age_hours}h"

if [[ "$age_hours" -ge "$MAX_AGE_HOURS" ]]; then
  fail "newest local snapshot is ${age_hours}h old (>= ${MAX_AGE_HOURS}h threshold). Server snapshot may be stale or rsync is silently failing."
fi

# ─── External-disk mirror (optional, weekly) ──────────────────────────────────

if [[ -n "$EXTERNAL_MIRROR_DIR" ]]; then
  today_dow="$(date +%w)"
  if [[ "$today_dow" == "$EXTERNAL_MIRROR_WEEKDAY" ]]; then
    if [[ -d "$EXTERNAL_MIRROR_DIR" ]]; then
      log "mirroring to ${EXTERNAL_MIRROR_DIR}"
      if rsync -az --delete "${LOCAL_SNAP_DIR}/" "${EXTERNAL_MIRROR_DIR}/" >> "$LOG_FILE" 2>&1; then
        log "  mirror OK"
      else
        log "  mirror FAILED (continuing — primary pull already succeeded)"
      fi
    else
      log "external mirror configured but ${EXTERNAL_MIRROR_DIR} not mounted; skipping"
    fi
  fi
fi

log "=== run OK ==="
exit 0

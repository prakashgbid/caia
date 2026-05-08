#!/usr/bin/env bash
# stolution disk cleanup — Tier 0 prerequisite for the velocity-acceleration plan.
#
# Reference: velocity-acceleration-strategy-2026-05-06.md §A.1.
#
# Purpose:
#   Reclaim 500-1000 GB of disk on stolution before deploying the
#   self-hosted GitHub Actions runner pool (Tier 1.1). Stolution's NVMe
#   was at 96-97% utilisation as of 2026-05-06; runner _work checkouts
#   need ~10-50 GB transient space per concurrent job.
#
# Safety:
#   • Read-only diagnostic mode by default. Pass --execute to perform
#     destructive operations.
#   • Each destructive step is preceded by a preview/snapshot.
#   • Postgres backup retention is preserved by default (--include-backups
#     opt-in only).
#   • Aborts if running in a tty without --execute, requires explicit
#     confirmation when --execute is set unless --yes is also passed.
#
# Operator workflow:
#   1. ssh stolution
#   2. bash <(curl -sL https://raw.githubusercontent.com/prakashgbid/caia/develop/scripts/stolution/disk-cleanup.sh)
#   3. Review the diagnostic output
#   4. Re-run with --execute --yes once satisfied
#   5. Verify df -h shows ≤80% utilisation
#
# Or run from the developer Mac (preferred — keeps the script versioned):
#   ssh stolution 'bash -s' < scripts/stolution/disk-cleanup.sh -- --execute --yes

set -euo pipefail

DRY_RUN=true
ASSUME_YES=false
INCLUDE_BACKUPS=false
RUNNER_WORK_AGE_DAYS=14
BACKUP_AGE_DAYS=30
JOURNAL_KEEP_DAYS=14
TARGET_USE_PCT=80

usage() {
  cat <<USAGE
Usage: $0 [--execute] [--yes] [--include-backups]
                 [--runner-age N] [--backup-age N] [--journal-keep-days N]
                 [--target-use-pct N]

  --execute              Actually perform destructive ops (default: dry-run)
  --yes                  Skip interactive confirmation
  --include-backups      Also remove postgres backups older than --backup-age
  --runner-age N         Reclaim runner _work checkouts older than N days (default: 14)
  --backup-age N         Backup retention horizon (default: 30 days)
  --journal-keep-days N  Keep last N days of systemd journals (default: 14)
  --target-use-pct N     Cleanup target as % disk used (default: 80)
  -h, --help             This help

Reference: velocity-acceleration-strategy-2026-05-06.md §A.1
USAGE
}

while (($#)); do
  case "$1" in
    --execute) DRY_RUN=false; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    --include-backups) INCLUDE_BACKUPS=true; shift ;;
    --runner-age) RUNNER_WORK_AGE_DAYS="$2"; shift 2 ;;
    --backup-age) BACKUP_AGE_DAYS="$2"; shift 2 ;;
    --journal-keep-days) JOURNAL_KEEP_DAYS="$2"; shift 2 ;;
    --target-use-pct) TARGET_USE_PCT="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "::error::unknown arg: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# ─── helpers ────────────────────────────────────────────────────────────────

log() { printf '[disk-cleanup] %s\n' "$*"; }
banner() { printf '\n=== %s ===\n' "$*"; }

run_or_dry() {
  if "$DRY_RUN"; then
    log "DRY-RUN: $*"
  else
    log "EXEC: $*"
    eval "$@"
  fi
}

current_use_pct() {
  df --output=pcent / | tail -1 | tr -d ' %'
}

free_gb() {
  df -BG --output=avail / | tail -1 | tr -dc '0-9'
}

# ─── 0. preconditions ──────────────────────────────────────────────────────

banner "0. preconditions"
log "host:        $(hostname)"
log "user:        $(whoami)"
log "uname:       $(uname -srm)"
log "starting df:"
df -h /
log "starting use: $(current_use_pct)%, free: $(free_gb)G"

if "$DRY_RUN"; then
  log "MODE: DRY-RUN. Pass --execute to perform destructive operations."
elif ! "$ASSUME_YES"; then
  if [ -t 0 ]; then
    read -rp "About to execute destructive cleanup. Continue? [y/N] " ans
    case "$ans" in y|Y|yes|YES) ;; *) log "aborted"; exit 1 ;; esac
  else
    echo "::error::--execute requires --yes when stdin is not a tty" >&2
    exit 2
  fi
fi

# ─── T0-1. audit current consumers ─────────────────────────────────────────

banner "T0-1. audit"
log "top-level disk consumers (non-recursive du, may take ~30s):"
# Avoid recursive du on the full filesystem — it amplifies IO pressure on
# a near-full disk. Sample only the well-known directories.
for dir in /var/log /var/lib/docker /home/s903 /tmp; do
  if [ -d "$dir" ]; then
    sz=$(du -sh "$dir" 2>/dev/null | awk '{print $1}' || echo '?')
    printf '  %-30s %s\n' "$dir" "${sz:-?}"
  fi
done

if command -v docker >/dev/null 2>&1; then
  log "docker storage:"
  docker system df 2>&1 | sed 's/^/  /' || log "  (docker daemon unresponsive)"
fi

# ─── T0-2. docker prune ────────────────────────────────────────────────────

banner "T0-2. docker prune (highest-leverage; expect 50-300 GB)"
if command -v docker >/dev/null 2>&1; then
  log "preview — dangling images:"
  docker image ls --filter dangling=true 2>&1 | head -10 | sed 's/^/  /' || true
  log "preview — stopped containers:"
  docker container ls -a --filter status=exited --filter status=created 2>&1 | head -10 | sed 's/^/  /' || true
  log "preview — unused volumes:"
  docker volume ls --filter dangling=true 2>&1 | head -10 | sed 's/^/  /' || true

  # Aggressive prune. -af prunes images not referenced by any container
  # (running or stopped). --volumes also prunes unused volumes.
  # WARNING: this WILL delete any data in unmounted volumes. Tagged images
  # for running services are preserved because the running container holds
  # a reference.
  run_or_dry "docker system prune -af --volumes"
else
  log "(docker not installed; skipping)"
fi

# ─── T0-3. runner _work cleanup ────────────────────────────────────────────

banner "T0-3. actions-runner _work (older than ${RUNNER_WORK_AGE_DAYS} days)"
RUNNER_WORK="/home/s903/actions-runner/_work"
if [ -d "$RUNNER_WORK" ]; then
  log "preview — workflow checkouts older than ${RUNNER_WORK_AGE_DAYS}d:"
  find "$RUNNER_WORK" -maxdepth 1 -mindepth 1 -type d -mtime "+${RUNNER_WORK_AGE_DAYS}" -ls 2>/dev/null \
    | head -20 | sed 's/^/  /' || true

  # Don't kill in-flight jobs. The --ephemeral runner pattern (Tier 1.1)
  # keeps _work clean per-job. For the current single-runner setup, the
  # +14d filter is safe.
  run_or_dry "find '$RUNNER_WORK' -maxdepth 1 -mindepth 1 -type d -mtime +${RUNNER_WORK_AGE_DAYS} -exec rm -rf {} +"
else
  log "(no $RUNNER_WORK; skipping)"
fi

# Also handle the per-runner _work directories from the Tier 1.1 pool.
for n in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16; do
  d="/home/s903/actions-runner-${n}/_work"
  [ -d "$d" ] || continue
  log "preview — pool runner ${n} (older than ${RUNNER_WORK_AGE_DAYS}d):"
  find "$d" -maxdepth 1 -mindepth 1 -type d -mtime "+${RUNNER_WORK_AGE_DAYS}" -ls 2>/dev/null \
    | head -5 | sed 's/^/  /' || true
  run_or_dry "find '$d' -maxdepth 1 -mindepth 1 -type d -mtime +${RUNNER_WORK_AGE_DAYS} -exec rm -rf {} +"
done

# ─── T0-4. journalctl rotation ─────────────────────────────────────────────

banner "T0-4. systemd journal vacuum (keep last ${JOURNAL_KEEP_DAYS} days)"
if command -v journalctl >/dev/null 2>&1; then
  log "preview — current journal size:"
  journalctl --disk-usage 2>&1 | sed 's/^/  /' || true
  run_or_dry "journalctl --vacuum-time=${JOURNAL_KEEP_DAYS}d"
else
  log "(no journalctl; skipping)"
fi

# ─── T0-5. postgres backup retention (opt-in only) ─────────────────────────

banner "T0-5. postgres backups (opt-in via --include-backups)"
BACKUP_DIR="/home/s903/backups"
if [ -d "$BACKUP_DIR" ]; then
  log "preview — backups older than ${BACKUP_AGE_DAYS}d:"
  find "$BACKUP_DIR" -name "*.dump" -mtime "+${BACKUP_AGE_DAYS}" -ls 2>/dev/null \
    | head -10 | sed 's/^/  /' || true

  if "$INCLUDE_BACKUPS"; then
    run_or_dry "find '$BACKUP_DIR' -name '*.dump' -mtime +${BACKUP_AGE_DAYS} -delete"
  else
    log "(skipping — pass --include-backups to remove)"
  fi
else
  log "(no $BACKUP_DIR; skipping)"
fi

# ─── verify ─────────────────────────────────────────────────────────────────

banner "verify"
log "ending df:"
df -h /
end_pct=$(current_use_pct)
end_gb=$(free_gb)
log "ending use: ${end_pct}%, free: ${end_gb}G"

if [ "$end_pct" -le "$TARGET_USE_PCT" ]; then
  log "✓ disk usage at or below target (${end_pct}% ≤ ${TARGET_USE_PCT}%)"
else
  log "⚠ still above target (${end_pct}% > ${TARGET_USE_PCT}%)"
  log "  Consider --include-backups, or investigate further."
  exit 3
fi

# ─── service health spot-check ─────────────────────────────────────────────

banner "service health"
if command -v docker >/dev/null 2>&1; then
  log "running containers:"
  docker ps --format 'table {{.Names}}\t{{.Status}}' 2>&1 | head -20 | sed 's/^/  /' || true
fi
log "load average: $(uptime)"

log "DONE"

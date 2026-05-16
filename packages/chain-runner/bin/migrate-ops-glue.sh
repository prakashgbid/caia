#!/bin/bash
# B4 (integration-remediation-b phase 4, 2026-05-15). One-shot migration:
# convert the 3 ops-glue scripts that live under ~/.caia/ into wrappers
# around the canonical version-controlled copies in this package's bin/,
# then rewrite the corresponding launchd plists to point directly at the
# canonical paths.
#
# What it moves:
#   ~/.caia/handoff/refresh_handoff.sh   →  packages/chain-runner/bin/refresh-handoff.sh
#   ~/.caia/hygiene/audit.sh             →  packages/chain-runner/bin/hygiene-audit.sh
#   ~/.caia/pr-drainer/drain.sh          →  packages/chain-runner/bin/pr-drain.sh
#
# What it leaves behind in ~/.caia/<dir>/:
#   - the original .sh file is renamed `<name>.sh.pre-b4-backup`.
#   - a fresh `<name>.sh` is written as a 2-line wrapper that execs the
#     canonical path. This preserves the path contract for any caller
#     (operator runbooks, the apprentice-loop, etc.) that still references
#     the legacy path.
#
# What it does to the plists (only when --rewrite-plists is passed):
#   - com.caia.handoff-refresh-hourly.plist
#   - com.caia.hygiene-audit-daily.plist
#   - com.caia.pr-drainer-hourly.plist
# The plist's ProgramArguments string is rewritten to point at the
# canonical bin/ path. A `.pre-b4-backup` of the plist is kept alongside.
# Operator follow-up: `launchctl bootload -w` the rewritten plists.
#
# Usage:
#   migrate-ops-glue.sh [--dry-run] [--rewrite-plists] [--force]

set -u

DRY_RUN=0
REWRITE_PLISTS=0
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --rewrite-plists) REWRITE_PLISTS=1 ;;
    --force) FORCE=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0 ;;
    *)
      echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

SELF_DIR=$(cd "$(dirname "$0")" && pwd -P)
CANONICAL_REFRESH="${SELF_DIR}/refresh-handoff.sh"
CANONICAL_HYGIENE="${SELF_DIR}/hygiene-audit.sh"
CANONICAL_DRAIN="${SELF_DIR}/pr-drain.sh"

LEGACY_REFRESH="${HOME}/.caia/handoff/refresh_handoff.sh"
LEGACY_HYGIENE="${HOME}/.caia/hygiene/audit.sh"
LEGACY_DRAIN="${HOME}/.caia/pr-drainer/drain.sh"

PLIST_REFRESH="${HOME}/Library/LaunchAgents/com.caia.handoff-refresh-hourly.plist"
PLIST_HYGIENE="${HOME}/Library/LaunchAgents/com.caia.hygiene-audit-daily.plist"
PLIST_DRAIN="${HOME}/Library/LaunchAgents/com.caia.pr-drainer-hourly.plist"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

# ----- step 1: convert legacy scripts to wrappers ------------------------
convert_to_wrapper() {
  local legacy="$1"; local canonical="$2"; local interp="$3"; local label="$4"
  if [ ! -f "$canonical" ]; then
    log "FAIL ${label}: canonical missing at ${canonical}"
    return 1
  fi
  if [ ! -f "$legacy" ]; then
    log "SKIP ${label}: legacy script absent at ${legacy} (already migrated?)"
    return 0
  fi
  # Skip if already a wrapper for the canonical.
  if head -5 "$legacy" 2>/dev/null | grep -q "# CAIA_OPS_GLUE_WRAPPER target="; then
    log "SKIP ${label}: ${legacy} already a wrapper"
    return 0
  fi

  if [ $DRY_RUN -eq 1 ]; then
    log "WOULD MIGRATE ${label}: ${legacy} → wrapper exec ${canonical}"
    return 0
  fi

  local backup="${legacy}.pre-b4-backup"
  if [ -e "$backup" ] && [ $FORCE -ne 1 ]; then
    log "FAIL ${label}: backup ${backup} already exists — pass --force to overwrite"
    return 1
  fi
  cp -p "$legacy" "$backup"
  cat > "$legacy" <<WRAPPER
${interp}
# CAIA_OPS_GLUE_WRAPPER target=${canonical}
# Legacy compat path; canonical lives under caia/packages/chain-runner/bin/.
# Re-emit the A2 health-check shim so launchctl/orphan probes get a live
# response from this path without needing to follow the exec.
case "\${1:-}" in
  --health-check)
    printf '{"ok":true,"label":"%s","script":"%s","git_sha":"%s","pid":%d,"timestamp":"%s","wrapper_target":"%s"}\\n' \\
      "\${CAIA_PLIST_LABEL:-unknown}" "\$0" "\${CAIA_GIT_SHA:-unknown}" "\$\$" \\
      "\$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" \\
      "${canonical}"
    exit 0
    ;;
esac
exec "${canonical}" "\$@"
WRAPPER
  chmod 0755 "$legacy"
  log "MIGRATED ${label}: ${legacy} → wrapper (backup=${backup})"
}

convert_to_wrapper "$LEGACY_REFRESH" "$CANONICAL_REFRESH" "#!/bin/zsh" "refresh-handoff"
convert_to_wrapper "$LEGACY_HYGIENE" "$CANONICAL_HYGIENE" "#!/bin/bash" "hygiene-audit"
convert_to_wrapper "$LEGACY_DRAIN"   "$CANONICAL_DRAIN"   "#!/bin/bash" "pr-drain"

# ----- step 2 (optional): rewrite plists ---------------------------------
rewrite_plist() {
  local plist="$1"; local from="$2"; local to="$3"; local label="$4"
  if [ ! -f "$plist" ]; then
    log "SKIP ${label}: plist absent at ${plist}"
    return 0
  fi
  if ! grep -q -F "$from" "$plist" 2>/dev/null; then
    log "SKIP ${label}: plist does not reference ${from}"
    return 0
  fi
  if [ $DRY_RUN -eq 1 ]; then
    log "WOULD REWRITE ${label}: ${plist} (${from} → ${to})"
    return 0
  fi
  local backup="${plist}.pre-b4-backup"
  if [ ! -e "$backup" ] || [ $FORCE -eq 1 ]; then
    cp -p "$plist" "$backup"
  fi
  # Replace the legacy path with the canonical path. Path may appear inside
  # the inline `-c` string; do a literal replace via python to avoid sed/BSD
  # vs GNU portability issues.
  /usr/bin/python3 - "$plist" "$from" "$to" <<'PY'
import sys, pathlib
path, old, new = sys.argv[1:4]
p = pathlib.Path(path)
text = p.read_text()
if old not in text:
    sys.exit(0)
p.write_text(text.replace(old, new))
PY
  log "REWROTE ${label}: ${plist} → ${to} (backup=${backup})"
}

if [ $REWRITE_PLISTS -eq 1 ]; then
  rewrite_plist "$PLIST_REFRESH" "$LEGACY_REFRESH" "$CANONICAL_REFRESH" "handoff-refresh"
  rewrite_plist "$PLIST_HYGIENE" "$LEGACY_HYGIENE" "$CANONICAL_HYGIENE" "hygiene-audit"
  rewrite_plist "$PLIST_DRAIN"   "$LEGACY_DRAIN"   "$CANONICAL_DRAIN"   "pr-drainer"
  log "plist rewrites complete — operator follow-up: \`launchctl bootload -w <plist>\` for any rewritten label"
else
  log "skipping plist rewrites (pass --rewrite-plists to enable)"
fi

log "done"
exit 0

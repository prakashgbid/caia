#!/bin/bash
# install-orphan-health-check-shims.sh
#
# Phase A2 (integration_remediation_plan_2026-05-14.md §A Phase A2).
#
# The 8 LaunchAgent-driven scripts that live under ~/.caia/* and
# ~/.local/share/chiefaia/* (i.e. NOT in the caia monorepo) need the
# `--health-check` flag injected into them so the post-merge deploy gate
# (A1) can verify they load. The orphans will be absorbed into the
# monorepo in §B (B2..B5); until then this installer patches them in
# place.
#
# Idempotent: each patch is wrapped in sentinel comments. Re-running is a
# no-op if the sentinel is present.
#
# Usage:
#   ./install-orphan-health-check-shims.sh          # install
#   ./install-orphan-health-check-shims.sh --check  # verify, exit 1 if any missing
#   ./install-orphan-health-check-shims.sh --remove # rip out the shims (for tests)

set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
TEMPLATE_DIR="$HERE/templates/health-check"

# Sentinel string is the kind-agnostic substring (works whether the host
# script uses `# >>>`, `// >>>`, or any other comment prefix).
SENTINEL_OPEN='caia-plist-health-check-shim (phase A2)'

# Format: <absolute-path>|<kind>
ORPHANS=(
  "$HOME/.caia/chain-watchdog/watchdog.js|node"
  "$HOME/.caia/handoff/refresh_handoff.sh|bash"
  "$HOME/.caia/hygiene/audit.sh|bash"
  "$HOME/.caia/pr-drainer/drain.sh|bash"
  "$HOME/.caia/chain-watchdog/redflag_remediation_wake.sh|bash"
  "$HOME/.caia/chain-watchdog/stability_completion_wake.sh|bash"
  "$HOME/.caia/chain-watchdog/tier25_wake.sh|bash"
  "$HOME/.local/share/chiefaia/sps/audit_recent_done.py|python"
)

has_shim() {
  grep -qF "$SENTINEL_OPEN" "$1" 2>/dev/null
}

# Pick the insertion point: first non-blank, non-comment, non-shebang line.
# This puts the shim right after the file's header comment block so the
# top-of-file documentation stays intact.
#
# Python special case: `from __future__ import …` must be the first
# statement in the file (after only comments / docstrings), so for kind=python
# we skip past any contiguous `from __future__` lines as well.
first_code_line() {
  local f=$1 kind=$2 i=2
  local n
  n=$(wc -l < "$f" | tr -d ' ')
  while [ "$i" -le "$n" ]; do
    local line
    line=$(sed -n "${i}p" "$f")
    case "$line" in
      ''|'#'*|'"""'*|"'''"*|'// '*|'//'*) i=$((i + 1));;
      *)
        if [ "$kind" = "python" ]; then
          case "$line" in
            'from __future__ '*) i=$((i + 1)); continue;;
          esac
        fi
        break;;
    esac
  done
  echo "$i"
}

template_for() {
  case "$1" in
    bash)   echo "$TEMPLATE_DIR/bash-shim.sh";;
    node)   echo "$TEMPLATE_DIR/node-shim.js";;
    python) echo "$TEMPLATE_DIR/python-shim.py";;
    *) echo "unknown kind: $1" >&2; return 1;;
  esac
}

install_shim() {
  local f=$1 kind=$2 tpl
  tpl=$(template_for "$kind")

  if [ ! -f "$f" ]; then
    echo "  skip (missing): $f"
    return 0
  fi
  if has_shim "$f"; then
    echo "  already-installed: $f"
    return 0
  fi
  if [ ! -f "$tpl" ]; then
    echo "  ERROR: template missing for kind=$kind: $tpl" >&2
    return 1
  fi

  local insert_at
  insert_at=$(first_code_line "$f" "$kind")
  local tmp
  tmp=$(mktemp)
  {
    sed -n "1,$((insert_at - 1))p" "$f"
    cat "$tpl"
    printf '\n'
    sed -n "${insert_at},\$p" "$f"
  } > "$tmp"

  # Preserve executable mode.
  local mode
  mode=$(stat -f '%Op' "$f" 2>/dev/null | tail -c 4 | head -c 3 || stat -c '%a' "$f")
  cat "$tmp" > "$f"
  rm -f "$tmp"
  chmod "$mode" "$f" 2>/dev/null || true
  echo "  installed:         $f"
}

remove_shim() {
  local f=$1
  if [ ! -f "$f" ]; then return 0; fi
  if ! has_shim "$f"; then
    echo "  not-installed:     $f"
    return 0
  fi
  local tmp
  tmp=$(mktemp)
  # The open sentinel is any line containing `>>> caia-plist-health-check-shim`
  # and the close sentinel is any line containing `<<< caia-plist-health-check-shim`,
  # so this remover handles `# >>> …` (bash/python) and `// >>> …` (node).
  awk '
    BEGIN { skipping=0; next_blank=0 }
    /^([^A-Za-z0-9]| )*>>> caia-plist-health-check-shim/ { skipping=1; next }
    /^([^A-Za-z0-9]| )*<<< caia-plist-health-check-shim/ { skipping=0; next_blank=1; next }
    { if (skipping) { next }
      if (next_blank && $0 == "") { next_blank=0; next }
      next_blank=0
      print
    }
  ' "$f" > "$tmp"
  cat "$tmp" > "$f"
  rm -f "$tmp"
  echo "  removed:           $f"
}

check_shim() {
  local f=$1
  if [ ! -f "$f" ]; then
    echo "  MISSING-FILE:      $f"
    return 1
  fi
  if has_shim "$f"; then
    echo "  ok:                $f"
    return 0
  fi
  echo "  MISSING-SHIM:      $f"
  return 1
}

MODE="${1:-install}"
case "$MODE" in
  install)
    echo "Installing --health-check shims into ${#ORPHANS[@]} orphan scripts..."
    for spec in "${ORPHANS[@]}"; do
      install_shim "${spec%%|*}" "${spec##*|}"
    done
    echo "Done."
    ;;
  --check|check)
    echo "Checking --health-check shims..."
    rc=0
    for spec in "${ORPHANS[@]}"; do
      check_shim "${spec%%|*}" || rc=1
    done
    exit "$rc"
    ;;
  --remove|remove)
    echo "Removing --health-check shims..."
    for spec in "${ORPHANS[@]}"; do
      remove_shim "${spec%%|*}"
    done
    ;;
  *)
    echo "Usage: $0 [install|--check|--remove]" >&2
    exit 64
    ;;
esac

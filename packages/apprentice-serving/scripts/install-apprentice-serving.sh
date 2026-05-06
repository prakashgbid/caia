#!/usr/bin/env bash
# Install canary-routing scaffolding for Apprentice Phase 3 serving.
#
# Phase 3 doesn't run a LaunchAgent (Phase 4's retrainer cron does). What
# this script DOES do:
#   1. Ensure the serving package is built.
#   2. Create the apprentice data root + canary-routing.json placeholder
#      (production: null, canary: null) if absent so consumers can read
#      it without ENOENT-handling.
#   3. Verify ollama is on PATH and the daemon answers (best-effort).
#
# Pattern follows `feedback_monorepo_regression_gate_ergonomics.md` rule 2:
# placeholder substitution, plutil-lint, dry-run mode.
#
# Usage:
#   scripts/install-apprentice-serving.sh
#
# Env-var overrides:
#   CAIA_APPRENTICE_DATA_ROOT  — default: $HOME/Documents/projects/apprentice
#   CAIA_OLLAMA_BIN            — default: $(command -v ollama)
#   CAIA_DRY_INSTALL=1         — render + sanity-check, don't write files

set -euo pipefail

DRY_INSTALL="${CAIA_DRY_INSTALL:-0}"

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DATA_ROOT="${CAIA_APPRENTICE_DATA_ROOT:-$HOME/Documents/projects/apprentice}"
CANARY_ROUTING="$DATA_ROOT/canary-routing.json"
REGISTRY="$DATA_ROOT/registry.json"
OLLAMA_BIN="${CAIA_OLLAMA_BIN:-$(command -v ollama 2>/dev/null || true)}"

if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "package not built: $PKG_DIR/dist" >&2
  echo "run 'pnpm --filter @chiefaia/apprentice-serving build' first" >&2
  exit 1
fi

if [[ -z "$OLLAMA_BIN" || ! -x "$OLLAMA_BIN" ]]; then
  echo "WARNING: ollama not found on PATH or not executable: $OLLAMA_BIN" >&2
  echo "  install: https://ollama.com/download" >&2
  echo "  serving will fail at promote-time until this is fixed." >&2
fi

if [[ "$DRY_INSTALL" == "1" ]]; then
  echo "CAIA_DRY_INSTALL=1: dry-run mode"
  echo "  data root would be:    $DATA_ROOT"
  echo "  canary-routing path:   $CANARY_ROUTING"
  echo "  registry path:         $REGISTRY"
  echo "  ollama binary:         ${OLLAMA_BIN:-MISSING}"
  exit 0
fi

mkdir -p "$DATA_ROOT"

# Seed canary-routing.json with the empty state if absent. ApprenticeServing
# tolerates ENOENT, so this is convenience-only — but having the file
# present makes consumers' first read deterministic.
if [[ ! -f "$CANARY_ROUTING" ]]; then
  cat > "$CANARY_ROUTING" <<EOF
{
  "version": 1,
  "generatedAt": "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)",
  "production": null,
  "canary": null
}
EOF
  echo "seeded $CANARY_ROUTING"
else
  echo "preserved existing $CANARY_ROUTING"
fi

# Don't seed registry.json — first ApprenticeServing.register() creates it
# with a single entry; an empty {entries:[]} would then need to be merged.
# Letting register() bootstrap is simpler and consistent with the read-
# fresh-on-every-mutation model.

echo "apprentice-serving install complete"
echo "  data root:     $DATA_ROOT"
echo "  canary config: $CANARY_ROUTING"
echo "  cli:           $PKG_DIR/dist/cli.js"
echo ""
echo "no LaunchAgent installed — Phase 4 retrainer cron drives state transitions."
echo "for ad-hoc operator use:"
echo "  node $PKG_DIR/dist/cli.js list"
echo "  node $PKG_DIR/dist/cli.js register <adapter-path>"
echo "  node $PKG_DIR/dist/cli.js promote-canary <adapter-path> --percent 10"

#!/usr/bin/env bash
# Apprentice eval — preflight check.
#
# Per DESIGN.md §13: this package does NOT ship a LaunchAgent. Eval is
# invoked on demand by:
#   - the operator (`caia-apprentice-eval run`)
#   - the Phase 4 retrainer (programmatically via ApprenticeEvalHarness)
#
# This script is a deploy-readiness check the retrainer (or the operator
# before a big run) calls to confirm the environment is sane. It does
# NOT bootstrap a launchd service.
#
# Usage: scripts/preflight.sh [--check-adapters]
#
# Exit codes:
#   0 — green: package built; provider reachable; (optionally) adapter loading works
#   1 — yellow: package built but a non-fatal warning fired; eval may still work
#   2 — red: package not built or no provider available; cannot run eval

set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CHECK_ADAPTERS=false
if [[ "${1:-}" == "--check-adapters" ]]; then
  CHECK_ADAPTERS=true
fi

YELLOW=0
echo "[preflight] apprentice-eval @ $PKG_DIR"

# 1. Built artifacts.
if [[ ! -d "$PKG_DIR/dist" ]]; then
  echo "[preflight] FAIL: dist/ missing — run \`pnpm --filter @chiefaia/apprentice-eval build\` first" >&2
  exit 2
fi
echo "[preflight] ✓ dist/ present"

# 2. Suite YAMLs.
SUITE_COUNT="$(find "$PKG_DIR/suites" -maxdepth 1 -type f -name '*.yaml' 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$SUITE_COUNT" == "0" ]]; then
  echo "[preflight] FAIL: no suites under $PKG_DIR/suites" >&2
  exit 2
fi
echo "[preflight] ✓ $SUITE_COUNT suite(s) under suites/"

# 3. Ollama reachable?
OLLAMA_URL="${OLLAMA_BASE_URL:-http://127.0.0.1:11434}"
if curl --silent --max-time 3 "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  echo "[preflight] ✓ Ollama reachable at $OLLAMA_URL"
  OLLAMA_OK=1
else
  echo "[preflight] WARN: Ollama unreachable at $OLLAMA_URL"
  OLLAMA_OK=0
  YELLOW=1
fi

# 4. mlx_lm fallback?
if python3 -c "import mlx_lm" >/dev/null 2>&1; then
  echo "[preflight] ✓ mlx_lm fallback available"
  MLX_OK=1
else
  echo "[preflight] WARN: mlx_lm not importable (Mac M-series only)"
  MLX_OK=0
  YELLOW=1
fi

if [[ "$OLLAMA_OK" == "0" && "$MLX_OK" == "0" ]]; then
  echo "[preflight] FAIL: no inference provider available" >&2
  exit 2
fi

# 5. Adapter check (optional, slow).
if [[ "$CHECK_ADAPTERS" == "true" && "$OLLAMA_OK" == "1" ]]; then
  VERSION="$(curl --silent "$OLLAMA_URL/api/version" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("version", ""))' 2>/dev/null || true)"
  if [[ -z "$VERSION" ]]; then
    echo "[preflight] WARN: could not read Ollama version (expected for /api/version pre-0.4)"
    YELLOW=1
  else
    MAJOR_MINOR="$(echo "$VERSION" | awk -F. '{ print $1"."$2 }')"
    echo "[preflight] Ollama version: $VERSION"
    if awk -v v="$MAJOR_MINOR" 'BEGIN { split(v,a,"."); exit !(a[1]>0 || (a[1]==0 && a[2]>=4)) }'; then
      echo "[preflight] ✓ Ollama supports adapter loading"
    else
      echo "[preflight] WARN: Ollama < 0.4 — eval will fall back to mlx_lm for adapter runs"
      YELLOW=1
    fi
  fi
fi

echo "[preflight] DONE"
exit "$YELLOW"

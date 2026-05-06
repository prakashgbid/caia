#!/usr/bin/env bash
# Install mlx-lm into a venv at ~/Documents/projects/apprentice/venv/.
# Idempotent — safe to re-run.
#
# This is the runtime dep that `@chiefaia/apprentice-training`'s subprocess
# spawn requires. We install into a project-local venv to avoid polluting
# system Python and to make the binary path reproducible.
#
# Usage:
#   scripts/install-mlx-lm.sh
#
# The trainer's preflight will verify mlx-lm is importable + has the
# expected flag set; if this script succeeds, preflight will pass.

set -euo pipefail

VENV_DIR="${APPRENTICE_VENV_DIR:-$HOME/Documents/projects/apprentice/venv}"

# Pick the best available Python — 3.13 preferred, 3.12 fallback. mlx-lm
# may not yet have wheels for 3.14 as of mid-2026.
PYTHON_CANDIDATES=(python3.13 python3.12 python3.11 python3)
PYTHON=""
for cand in "${PYTHON_CANDIDATES[@]}"; do
  if command -v "$cand" >/dev/null 2>&1; then
    PYTHON="$cand"
    break
  fi
done

if [[ -z "$PYTHON" ]]; then
  echo "no python3 found on PATH" >&2
  exit 1
fi

PYVER="$($PYTHON --version 2>&1 | awk '{print $2}')"
echo "using $PYTHON ($PYVER)"

if [[ ! -d "$VENV_DIR" ]]; then
  echo "creating venv at $VENV_DIR"
  "$PYTHON" -m venv "$VENV_DIR"
fi

VENV_PIP="$VENV_DIR/bin/pip"
VENV_PYTHON="$VENV_DIR/bin/python"

"$VENV_PIP" install --quiet --upgrade pip
"$VENV_PIP" install --quiet mlx-lm

# Verify importability + flag set.
if ! "$VENV_PYTHON" -c "import mlx_lm; import mlx_lm.lora" 2>/dev/null; then
  echo "mlx-lm install verification failed" >&2
  exit 1
fi

# Verify the canonical flags we depend on are present.
HELP_OUT=$("$VENV_PYTHON" -m mlx_lm.lora --help 2>&1 || true)
REQUIRED=(--train --model --data --adapter-path --num-layers --iters --batch-size --learning-rate --max-seq-length)
for flag in "${REQUIRED[@]}"; do
  if ! echo "$HELP_OUT" | grep -q -- "$flag"; then
    echo "WARNING: mlx-lm --help did not list required flag $flag" >&2
  fi
done

echo "ok — mlx-lm installed at $VENV_DIR"
echo "set PYTHON_BINARY=$VENV_PYTHON before running caia-apprentice-training"

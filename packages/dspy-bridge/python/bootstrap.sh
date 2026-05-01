#!/usr/bin/env bash
# Bootstrap the Python side of @chiefaia/dspy-bridge using `uv`.
#
# Why `uv` (not pipx, not poetry, not raw pip):
#   - it's the substrate runbook's pinned manager (caia/docs/dspy-substrate.md)
#   - 10-100x faster than pip for cold installs
#   - native lockfile + reproducible installs
#   - never touches system Python
#
# This script is idempotent. Re-run after editing pyproject.toml.

set -euo pipefail

cd "$(dirname "$0")"

if ! command -v uv >/dev/null 2>&1; then
  cat <<EOF >&2
✗ \`uv\` is not on PATH. Install it first:
    curl -LsSf https://astral.sh/uv/install.sh | sh
  ...or via Homebrew:
    brew install uv
  Reference: caia/docs/dspy-substrate.md §Bootstrap
EOF
  exit 1
fi

echo "→ uv sync (pinned 3.11 ≤ python < 3.13)"
uv sync --python 3.12

echo "✓ Python env ready under .venv/"
echo "→ smoke: pnpm --filter @chiefaia/dspy-bridge run py:smoke"

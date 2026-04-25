#!/bin/bash
set -euo pipefail
HOOKS_DIR="$(dirname "$0")/../hooks"
GIT_HOOKS="$(git rev-parse --git-dir)/hooks"
cp "$HOOKS_DIR/pre-commit" "$GIT_HOOKS/pre-commit"
cp "$HOOKS_DIR/post-commit" "$GIT_HOOKS/post-commit"
chmod +x "$GIT_HOOKS/pre-commit" "$GIT_HOOKS/post-commit"
echo "✅ Git hooks installed"

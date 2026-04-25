#!/bin/bash
set -euo pipefail
echo "Running verify:all..."
npm run typecheck && echo "✅ typecheck"
npm run test && echo "✅ tests"
npm run build && echo "✅ build"
echo "✅ All checks passed"

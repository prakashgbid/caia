#!/usr/bin/env bash
# scripts/fix-it/run-sharded-locally.sh
#
# Local equivalent of the FIX-012 sharded-CI workflow. Useful for
# reproducing CI failures or for shaking out a flaky shard before
# pushing.
#
# Usage:
#   ./scripts/fix-it/run-sharded-locally.sh <total-shards>
#   # default: 5
#
# What it does:
#   - Runs `playwright test --shard=i/N --reporter=blob` for i in 1..N
#   - Each blob lands in `./blob-report-i/`
#   - Calls scripts/fix-it/aggregate-shard-results.mjs to produce the
#     same shard-summary.json as CI
#
# Modes:
#   - If BROWSERLESS_WS_ENDPOINT is set, all shards talk to remote
#     Browserless (the CI shape).
#   - If unset, each shard runs against local Playwright workers. In
#     that case, run with `--shard 1` to keep things sane on a laptop.

set -euo pipefail

N="${1:-5}"
if ! [[ "$N" =~ ^[0-9]+$ ]] || [ "$N" -lt 1 ] || [ "$N" -gt 30 ]; then
  echo "FAIL: total-shards must be 1..30 (got: $N)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

# Reset blob-report dirs from prior runs so the summary is clean.
rm -rf blob-report-* shard-summary.json
mkdir -p blob-reports

for i in $(seq 1 "$N"); do
  echo "=== shard ${i}/${N} ==="
  pnpm exec playwright test \
    --shard="${i}/${N}" \
    --reporter=blob \
    --output="blob-report-${i}" \
    || echo "[shard ${i}] failed (continuing)"
  if [ -d "blob-report-${i}" ]; then
    cp -r "blob-report-${i}"/* blob-reports/ 2>/dev/null || true
  fi
done

echo
echo "=== aggregate ==="
node "${REPO_ROOT}/scripts/fix-it/aggregate-shard-results.mjs" blob-reports

echo
echo "Done. See shard-summary.json for per-shard totals."

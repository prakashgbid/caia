#!/usr/bin/env bash
# scripts/__tests__/reuse-check.test.sh
#
# Smoke test for `scripts/reuse-check.js` (INT.1.A4 — Guardrail #9).
#
# Approach: build a temporary git repo skeleton with one fake
# `@chiefaia/errors` package and one PR-branch source file that
# re-implements `CaiaError`. Run reuse-check against the temp tree and
# assert the output names the package.
#
# Run: bash scripts/__tests__/reuse-check.test.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/reuse-check.js"
TMPDIR="$(mktemp -d -t reuse-check-test.XXXXXX)"
trap 'rm -rf "$TMPDIR"' EXIT

cd "$TMPDIR"
git init -q -b main
git config user.email test@local
git config user.name test

mkdir -p packages/errors/src
cat > packages/errors/package.json <<'JSON'
{ "name": "@chiefaia/errors", "version": "0.0.0" }
JSON
cat > packages/errors/src/index.ts <<'TS'
export class CaiaError extends Error { code: string; constructor(m: string, c: string) { super(m); this.code = c; } }
export interface SerializedError { name: string; message: string; }
TS

git add -A && git commit -q -m "base"
git branch develop
git branch pr

git checkout -q pr
mkdir -p packages/newpkg
cat > packages/newpkg/reimpl.ts <<'TS'
export class CaiaError extends Error {}
export interface SerializedError { foo: string; }
export const xy = 1; // too short, must NOT flag
export const config = {}; // stopword, must NOT flag
TS
git add -A && git commit -q -m "reimpl"

# Run the script with the temp repo as REPO_ROOT and develop as the base ref.
output="$(REUSE_CHECK_REPO_ROOT="$TMPDIR" REUSE_CHECK_BASE_REF=develop node "$SCRIPT" 2>/dev/null)"

fail=0
if ! grep -q 'CaiaError' <<< "$output"; then
  echo "FAIL: expected CaiaError to be flagged"; fail=1
fi
if ! grep -q '@chiefaia/errors' <<< "$output"; then
  echo "FAIL: expected @chiefaia/errors to appear in findings"; fail=1
fi
if ! grep -q 'SerializedError' <<< "$output"; then
  echo "FAIL: expected SerializedError to be flagged"; fail=1
fi
if grep -q '\b xy \b\|`xy`' <<< "$output"; then
  echo "FAIL: identifier 'xy' should be below MIN_LENGTH and NOT appear"; fail=1
fi
if grep -qE '\bconfig\b' <<< "$output"; then
  echo "FAIL: identifier 'config' is a stopword and must NOT appear"; fail=1
fi

# Negative test — same diff, but the changed file lives in __tests__ → skipped.
cd "$TMPDIR"
git checkout -q develop
mkdir -p packages/newpkg/__tests__
cat > packages/newpkg/__tests__/reimpl.test.ts <<'TS'
export class CaiaError extends Error {}
TS
git add -A && git commit -q -m "in __tests__"
output2="$(REUSE_CHECK_REPO_ROOT="$TMPDIR" REUSE_CHECK_BASE_REF=develop~1 node "$SCRIPT" 2>/dev/null)"
if grep -q 'CaiaError' <<< "$output2"; then
  echo "FAIL: identifier inside __tests__ must be skipped"; fail=1
fi

if [ "$fail" -ne 0 ]; then
  echo "---"
  echo "Output was:"
  echo "$output"
  exit 1
fi

echo "OK: reuse-check.js self-test passed"

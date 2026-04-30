#!/usr/bin/env bash
# scripts/evidence-gate-smoke-test.sh
#
# DELIBERATELY VIOLATING SCRIPT — used to prove the Evidence Gate's
# blocking semgrep rule (caia-no-admin-merge) fires on a real PR.
# This file ships in chore/evidence-gate-smoke-test ONLY; it must be
# reverted before the smoke test PR is closed.
#
# DO NOT MERGE THIS PR.

set -euo pipefail

# This is the violation: --admin bypasses required status checks.
# Expected: semgrep job FAILS with caia-no-admin-merge rule firing.
gh pr merge 999999 --admin --squash --delete-branch

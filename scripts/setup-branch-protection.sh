#!/usr/bin/env bash
# scripts/setup-branch-protection.sh
#
# Configures GitHub branch protection on `main` and `develop` for the CAIA
# repository. Idempotent — re-running just refreshes the rules to match.
#
# Required rules (server-side, enforced for everyone including admins):
#   - Require PR to merge — no direct pushes.
#   - Require status checks green:
#       * "Build · Test · Lint · Typecheck"  (.github/workflows/ci.yml)
#       * "gitflow-conformance"              (.github/workflows/gitflow-conformance.yml)
#   - Require strict status checks (branch up-to-date with target before merge).
#   - Require linear history (squash or rebase merge only).
#   - No force-push, no deletion.
#   - Apply rules to admins (enforce_admins=true).
#   - Require conversation resolution before merge.
#   - 0 required reviewers (solo founder; the PR + CI gates are the protection).
#
# Reference:
#   - feedback_git_flow_enforced.md
#   - caia/docs/git-flow.md
#
# Usage:
#   scripts/setup-branch-protection.sh [main|develop|all]   (default: all)
#
# Auth: requires `gh auth login` with admin scope on the repo.

set -euo pipefail

OWNER="${CAIA_OWNER:-prakashgbid}"
REPO="${CAIA_REPO:-caia}"
TARGET="${1:-all}"

# Required status check contexts, identical for both branches.
# pipeline-regression is path-conditional in its workflow file, so it cannot
# be a globally-required check (it would false-fail PRs that don't touch its
# trigger paths). The workflow itself fails the PR when it does run.
REQUIRED_CONTEXTS_JSON='["Build · Test · Lint · Typecheck", "gitflow-conformance"]'

protection_body() {
  cat <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ${REQUIRED_CONTEXTS_JSON}
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false,
    "require_last_push_approval": false,
    "required_approving_review_count": 0
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
}

apply() {
  local branch="$1"
  echo "→ ${OWNER}/${REPO}: applying protection to '${branch}'"
  protection_body | gh api --method PUT \
    -H "Accept: application/vnd.github+json" \
    "repos/${OWNER}/${REPO}/branches/${branch}/protection" \
    --input - > /dev/null
  echo "  ✓ ${branch} protected."
}

verify() {
  local branch="$1"
  echo "→ verifying ${branch}"
  gh api "repos/${OWNER}/${REPO}/branches/${branch}/protection" \
    --jq '{strict: .required_status_checks.strict,
            checks: [.required_status_checks.checks[].context],
            enforce_admins: .enforce_admins.enabled,
            linear_history: .required_linear_history.enabled,
            force_push: .allow_force_pushes.enabled,
            deletions: .allow_deletions.enabled,
            reviews_required: .required_pull_request_reviews.required_approving_review_count}'
}

case "${TARGET}" in
  main)
    apply main
    verify main
    ;;
  develop)
    apply develop
    verify develop
    ;;
  all)
    apply main
    apply develop
    echo
    verify main
    echo
    verify develop
    ;;
  *)
    echo "Usage: $0 [main|develop|all]" >&2
    exit 2
    ;;
esac

echo
echo "✓ Branch protection configured for ${TARGET}."

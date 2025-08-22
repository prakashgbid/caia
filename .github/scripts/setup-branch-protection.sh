#!/bin/bash

# Setup Branch Protection Rules for GitHub Repository
# This script configures branch protection to prevent direct commits to main

set -e

REPO_OWNER="prakashgbid"
REPO_NAME="caia"
BRANCH="main"

echo "🔒 Setting up branch protection rules for $REPO_OWNER/$REPO_NAME..."

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first."
    echo "   Visit: https://cli.github.com/"
    exit 1
fi

# Check authentication
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Please run: gh auth login"
    exit 1
fi

echo "📋 Configuring main branch protection..."

# Create the branch protection rule
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/$REPO_OWNER/$REPO_NAME/branches/$BRANCH/protection" \
  --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Pre-flight Checks",
      "Quality Check",
      "Tests (ubuntu-latest, 18.x)",
      "Tests (ubuntu-latest, 20.x)",
      "Security Analysis",
      "PR Validation",
      "Size Check",
      "Dependency Review"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismissal_restrictions": {},
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF

echo "✅ Branch protection rules applied successfully!"

# Create CODEOWNERS file if it doesn't exist
if [ ! -f ".github/CODEOWNERS" ]; then
    echo "📝 Creating CODEOWNERS file..."
    cat > .github/CODEOWNERS <<EOF
# CODEOWNERS for CAIA Repository
# These owners will be requested for review when someone opens a pull request

# Global owners
* @$REPO_OWNER

# Core package owners
/packages/core/ @$REPO_OWNER

# Agent packages
/packages/agents/ @$REPO_OWNER

# Engine packages
/packages/engines/ @$REPO_OWNER

# CI/CD and GitHub workflows
/.github/ @$REPO_OWNER
EOF
    echo "✅ CODEOWNERS file created!"
fi

echo "
🎉 Branch protection setup complete!

Current configuration:
✅ Direct commits to main branch: BLOCKED
✅ Pull requests required: YES
✅ Required approvals: 1
✅ Status checks must pass: YES
✅ Dismiss stale reviews: YES
✅ Require up-to-date branches: YES
✅ Require conversation resolution: YES

Next steps:
1. All changes must go through pull requests
2. Create feature branches for new work
3. PRs must pass all checks before merging
4. At least 1 approval required
"
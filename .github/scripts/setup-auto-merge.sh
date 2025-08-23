#!/bin/bash

# Setup auto-merge configuration for GitHub repository
# This script configures branch protection and auto-merge settings

set -e

REPO_OWNER=${1:-prakashgbid}
REPO_NAME=${2:-caia}
MAIN_BRANCH=${3:-main}

echo "🔧 Setting up auto-merge configuration for $REPO_OWNER/$REPO_NAME"

# Check if gh CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) is not installed. Please install it first."
    exit 1
fi

# Check authentication
if ! gh auth status &> /dev/null; then
    echo "❌ Not authenticated with GitHub. Run 'gh auth login' first."
    exit 1
fi

echo "📋 Configuring branch protection for $MAIN_BRANCH..."

# Enable auto-merge for the repository
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/$REPO_OWNER/$REPO_NAME \
  -f allow_auto_merge=true \
  -f allow_squash_merge=true \
  -f allow_merge_commit=false \
  -f allow_rebase_merge=false \
  -f delete_branch_on_merge=true

echo "✅ Repository auto-merge settings configured"

# Configure branch protection rules
echo "🛡️ Setting up branch protection rules..."

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  /repos/$REPO_OWNER/$REPO_NAME/branches/$MAIN_BRANCH/protection \
  -F "required_status_checks[strict]=true" \
  -F "required_status_checks[contexts][]=continuous-integration" \
  -F "required_status_checks[contexts][]=lint" \
  -F "required_status_checks[contexts][]=test" \
  -F "enforce_admins=false" \
  -F "required_pull_request_reviews[required_approving_review_count]=1" \
  -F "required_pull_request_reviews[dismiss_stale_reviews]=true" \
  -F "required_pull_request_reviews[require_code_owner_reviews]=false" \
  -F "required_pull_request_reviews[require_last_push_approval]=false" \
  -F "allow_force_pushes=false" \
  -F "allow_deletions=false" \
  -F "required_conversation_resolution=true" \
  -F "lock_branch=false" \
  -F "allow_fork_syncing=true"

echo "✅ Branch protection configured for $MAIN_BRANCH"

# Create GitHub Actions workflow for auto-merge
echo "📝 Creating auto-merge workflow..."

mkdir -p .github/workflows

cat > .github/workflows/auto-merge.yml << 'EOF'
name: Auto Merge

on:
  pull_request:
    types:
      - labeled
      - unlabeled
      - synchronize
      - opened
      - edited
      - ready_for_review
      - reopened
      - unlocked
  pull_request_review:
    types:
      - submitted
  check_suite:
    types:
      - completed
  status: {}

jobs:
  auto-merge:
    runs-on: ubuntu-latest
    if: github.event.pull_request.draft == false
    steps:
      - name: Checkout
        uses: actions/checkout@v3
        
      - name: Auto merge
        uses: pascalgn/merge-action@v0.15.0
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          MERGE_LABELS: "auto-merge,!work-in-progress,!do-not-merge"
          MERGE_METHOD: "squash"
          MERGE_COMMIT_MESSAGE: "pull-request-title-and-description"
          MERGE_FORKS: "false"
          MERGE_RETRIES: "3"
          MERGE_RETRY_SLEEP: "10000"
          UPDATE_LABELS: ""
          UPDATE_METHOD: "rebase"
          MERGE_DELETE_BRANCH: "true"
          MERGE_ERROR_FAIL: "false"
          MERGE_READY_STATE: "clean,has_hooks,unknown,unstable"
EOF

echo "✅ Auto-merge workflow created"

# Create merge queue configuration
echo "📦 Setting up merge queue..."

cat > .github/merge-queue.yml << 'EOF'
# Merge Queue Configuration
queue_rules:
  - name: default
    conditions:
      - check-success=lint
      - check-success=test
      - check-success=typecheck
      - "#approved-reviews-by>=1"
      - -draft
      - -conflict
    merge_method: squash
    update_method: rebase
    batch_size: 5
    batch_max_wait_time: 10m
EOF

echo "✅ Merge queue configured"

# Create dependabot configuration for automated dependency updates
echo "🤖 Setting up Dependabot..."

cat > .github/dependabot.yml << 'EOF'
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
      time: "03:00"
    open-pull-requests-limit: 10
    labels:
      - "dependencies"
      - "auto-merge"
    reviewers:
      - "prakashgbid"
    commit-message:
      prefix: "chore"
      include: "scope"
EOF

echo "✅ Dependabot configured"

# Create PR template
echo "📄 Creating PR template..."

mkdir -p .github/PULL_REQUEST_TEMPLATE

cat > .github/pull_request_template.md << 'EOF'
## Description
Brief description of the changes in this PR.

## Type of Change
- [ ] Bug fix (non-breaking change which fixes an issue)
- [ ] New feature (non-breaking change which adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to not work as expected)
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Testing
- [ ] Unit tests pass locally
- [ ] Integration tests pass locally
- [ ] Manual testing completed

## Checklist
- [ ] My code follows the style guidelines of this project
- [ ] I have performed a self-review of my own code
- [ ] I have commented my code, particularly in hard-to-understand areas
- [ ] I have made corresponding changes to the documentation
- [ ] My changes generate no new warnings
- [ ] I have added tests that prove my fix is effective or that my feature works
- [ ] New and existing unit tests pass locally with my changes
- [ ] Any dependent changes have been merged and published

## Related Issues
Closes #(issue number)

## Screenshots (if applicable)
Add screenshots to help explain your changes

## Additional Notes
Any additional information that reviewers should know
EOF

echo "✅ PR template created"

echo ""
echo "🎉 Auto-merge configuration complete!"
echo ""
echo "📌 Next steps:"
echo "1. Commit and push these configuration files"
echo "2. Ensure GitHub Actions are enabled for the repository"
echo "3. Add 'auto-merge' label to PRs you want to auto-merge"
echo "4. PRs must pass all checks and have at least 1 approval"
echo ""
echo "🏷️ Label usage:"
echo "  - 'auto-merge': Enable auto-merge for the PR"
echo "  - 'work-in-progress': Prevent auto-merge"
echo "  - 'do-not-merge': Block auto-merge"
EOF
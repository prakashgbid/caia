# AI Code Reviewers Setup Guide

This repository uses three AI-powered code reviewers to ensure code quality and catch issues early. All three services offer free tiers suitable for this open-source project.

## 🤖 Active AI Reviewers

### 1. CodeRabbit (Free for Open Source)
- **Status**: ✅ Active (Free forever for open source)
- **Installation**: Visit [CodeRabbit Marketplace](https://github.com/marketplace/coderabbitai)
- **Features**:
  - Automatic PR reviews on every push
  - Line-by-line code suggestions
  - PR summaries and release notes
  - Interactive chat via @coderabbitai mentions
- **Configuration**: `.coderabbit.yaml`

### 2. PR-Agent / Qodo (75 Free Reviews/Month)
- **Status**: ✅ Active (Free tier)
- **Activation**: Automatically reviews PRs or mention @CodiumAI-Agent in comments
- **Features**:
  - GPT-powered code analysis
  - Security vulnerability detection
  - Performance optimization suggestions
  - Test coverage analysis
- **Configuration**: `.github/workflows/ai-pr-review.yml`

### 3. Google Gemini CLI (Completely Free)
- **Status**: ✅ Active (100% free, no limits)
- **Features**:
  - Comprehensive code quality analysis
  - Security and performance reviews
  - Best practices enforcement
  - Detailed feedback with ratings
- **Configuration**: `.github/workflows/ai-pr-review.yml`

## 📋 How to Use

### Automatic Reviews
All three reviewers will automatically analyze your PR when you:
1. Open a new pull request
2. Push new commits to an existing PR
3. Reopen a closed PR

### Interactive Reviews

#### CodeRabbit
- Comment `@coderabbitai review` to request a review
- Comment `@coderabbitai resolve` to auto-fix issues
- Comment `@coderabbitai help` for more commands

#### PR-Agent (Qodo)
- Comment `@CodiumAI-Agent /review` for a comprehensive review
- Comment `@CodiumAI-Agent /improve` for improvement suggestions
- Comment `@CodiumAI-Agent /ask [question]` to ask about the code

### Manual Triggers
You can manually trigger reviews by:
1. Re-running the GitHub Actions workflow
2. Using the reviewer commands mentioned above
3. Pushing an empty commit: `git commit --allow-empty -m "Trigger AI reviews"`

## ⚙️ Configuration

### CodeRabbit
Edit `.coderabbit.yaml` to customize:
- Review triggers and branches
- Language preferences
- Path-specific instructions
- Security and performance checks

### GitHub Actions
Edit `.github/workflows/ai-pr-review.yml` to customize:
- Review prompts and focus areas
- Exclusion patterns
- API keys for enhanced features

## 🔒 Security & Privacy

- **CodeRabbit**: No code retention, SOC 2 Type II compliant
- **PR-Agent**: Processes code via GitHub API, no permanent storage
- **Google Gemini**: Enterprise-grade security, no training on your code

## 📊 Review Requirements

Current branch protection settings require:
- **2 approving reviews** before merge
- **Code owner review** (@prakashgbid)
- **Dismissal of stale reviews** when new commits are pushed

Note: AI reviewers provide valuable feedback but don't count as approving reviews. Human review is still required for merge.

## 🚀 Best Practices

1. **Address AI feedback** before requesting human review
2. **Use interactive commands** to clarify suggestions
3. **Don't ignore security warnings** from any reviewer
4. **Combine insights** from all three reviewers
5. **Update configurations** based on project needs

## 📝 Monthly Limits

- **CodeRabbit**: Unlimited (open source)
- **PR-Agent**: 75 reviews/month (reset monthly)
- **Google Gemini**: Unlimited
- **Total**: Effectively unlimited reviews

## 🆘 Troubleshooting

### Reviews not appearing?
1. Check GitHub Actions tab for workflow runs
2. Ensure PR is not in draft mode
3. Verify branch protection settings
4. Check monthly limits for PR-Agent

### Need more reviews?
- CodeRabbit and Gemini have no limits
- For PR-Agent, space out reviews or upgrade to paid tier
- Consider adding OpenAI API key for enhanced reviews

## 📚 Resources

- [CodeRabbit Documentation](https://docs.coderabbit.ai/)
- [PR-Agent Documentation](https://github.com/Codium-ai/pr-agent)
- [Google Gemini CLI Documentation](https://github.com/google-github-actions/run-gemini-cli)
- [CAIA Project Guidelines](../README.md)

---

*Last Updated: December 2024*
*Maintained by: @prakashgbid*
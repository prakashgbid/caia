# NPM Organization Setup - @caia

This document outlines the complete setup process for creating and managing the `@caia` NPM organization for publishing CAIA packages.

## Prerequisites

- NPM account with 2FA enabled
- Admin access to create organizations
- GitHub repository with proper permissions
- Node.js >= 18.0.0 and npm >= 9.0.0

## 1. Create NPM Organization

### Step 1: Create Organization on NPM
```bash
# Login to NPM
npm login

# Create organization (via NPM website or CLI)
npm org create @caia
```

### Step 2: Configure Organization Settings
```bash
# Set organization visibility to public
npm org set @caia public

# Add team members
npm org add @caia username --role developer
npm org add @caia username --role admin
```

### Step 3: Configure Access Tokens
```bash
# Create automation token for CI/CD
npm token create --type automation --scope @caia

# Store token securely in GitHub Secrets as NPM_TOKEN
```

## 2. Package Configuration

### Root Package.json Setup
```json
{
  "name": "@caia/root",
  "private": true,
  "workspaces": [
    "packages/core",
    "packages/agents/*",
    "packages/engines/*",
    "packages/utils/*",
    "packages/integrations/*",
    "packages/modules/*",
    "packages/tools/*"
  ],
  "publishConfig": {
    "registry": "https://registry.npmjs.org/",
    "access": "public"
  }
}
```

### Individual Package Configuration
Each package should have:
```json
{
  "name": "@caia/package-name",
  "version": "1.0.0",
  "publishConfig": {
    "registry": "https://registry.npmjs.org/",
    "access": "public"
  },
  "repository": {
    "type": "git",
    "url": "https://github.com/caia-ai/caia.git",
    "directory": "packages/package-name"
  }
}
```

## 3. Automated Publishing Workflow

### Lerna Configuration
```json
{
  "version": "independent",
  "npmClient": "npm",
  "command": {
    "publish": {
      "conventionalCommits": true,
      "message": "chore(release): publish",
      "registry": "https://registry.npmjs.org/",
      "access": "public"
    },
    "version": {
      "allowBranch": ["main", "release/*"],
      "conventionalCommits": true
    }
  }
}
```

### Publishing Commands
```bash
# Publish all changed packages
npm run publish:changed

# Publish specific version
npm run version:patch && npm run publish:all

# Publish with specific tag
lerna publish --dist-tag beta
```

## 4. Version Management Strategy

### Semantic Versioning
- **Major (X.0.0)**: Breaking changes
- **Minor (0.X.0)**: New features, backward compatible
- **Patch (0.0.X)**: Bug fixes, backward compatible

### Release Branches
```bash
# Create release branch
git checkout -b release/v1.2.0

# Version packages
npm run version:minor

# Merge to main and tag
git checkout main
git merge release/v1.2.0
git tag v1.2.0
```

### Pre-release Versions
```bash
# Beta releases
lerna version prerelease --preid beta

# Alpha releases
lerna version prerelease --preid alpha

# Release candidates
lerna version prerelease --preid rc
```

## 5. Quality Gates

### Pre-publish Checks
```bash
# Run before any publish
npm run lint
npm run test:all
npm run build:all
npm run test:coverage
```

### Package Validation
```bash
# Validate package before publish
npm pack --dry-run
npm audit
npm outdated
```

## 6. GitHub Integration

### Repository Secrets
Add these secrets to GitHub repository:
- `NPM_TOKEN`: Automation token for publishing
- `GITHUB_TOKEN`: For GitHub releases

### Protection Rules
- Require status checks for main branch
- Require pull request reviews
- Restrict push to main branch
- Enable automatic security updates

## 7. Monitoring and Maintenance

### NPM Analytics
```bash
# Check package downloads
npm view @caia/package-name

# Check all organization packages
npm org ls @caia
```

### Security Monitoring
```bash
# Regular security audits
npm audit --audit-level moderate

# Update dependencies
npm update
lerna exec -- npm update
```

### Automated Maintenance
- Weekly dependency updates via Dependabot
- Monthly security audits
- Quarterly package cleanup

## 8. Troubleshooting

### Common Issues

#### Publishing Fails
```bash
# Check authentication
npm whoami

# Verify organization access
npm org ls @caia

# Check package.json configuration
npm pack --dry-run
```

#### Version Conflicts
```bash
# Reset version
git checkout HEAD -- package.json

# Force version
lerna version --force-publish
```

#### Registry Issues
```bash
# Check registry configuration
npm config get registry

# Set correct registry
npm config set registry https://registry.npmjs.org/
```

## 9. Best Practices

### Package Naming
- Use kebab-case: `@caia/my-package`
- Be descriptive: `@caia/agent-orchestrator`
- Avoid generic names: `@caia/utils` (prefer `@caia/core-utils`)

### Documentation
- Include comprehensive README.md
- Add API documentation
- Provide usage examples
- Document breaking changes

### Testing
- Maintain >90% test coverage
- Include integration tests
- Test across Node.js versions
- Validate TypeScript definitions

### Security
- Regular dependency updates
- Enable 2FA for all maintainers
- Use least privilege access
- Monitor for vulnerabilities

## 10. Package Categories

### Core Packages
- `@caia/core` - Core functionality
- `@caia/types` - TypeScript definitions
- `@caia/config` - Configuration utilities

### Agent Packages
- `@caia/agent-base` - Base agent implementation
- `@caia/agent-orchestrator` - Agent orchestration
- `@caia/agent-registry` - Agent discovery

### Engine Packages
- `@caia/execution-engine` - Task execution
- `@caia/workflow-engine` - Workflow management
- `@caia/decision-engine` - Decision making

### Utility Packages
- `@caia/logger` - Logging utilities
- `@caia/metrics` - Performance metrics
- `@caia/security` - Security utilities

### Integration Packages
- `@caia/github` - GitHub integration
- `@caia/jira` - JIRA integration
- `@caia/slack` - Slack integration

## Quick Reference

### Essential Commands
```bash
# Setup
npm login
npm org create @caia

# Development
npm run build:all
npm run test:all
npm run lint

# Publishing
npm run version:patch
npm run publish:changed

# Maintenance
npm audit
npm outdated
npm org ls @caia
```

### File Locations
- Lerna config: `lerna.json`
- NPM config: `.npmrc`
- GitHub workflows: `.github/workflows/`
- Package configs: `packages/*/package.json`

---

*Last updated: December 2024*
*Maintained by: CAIA DevOps Team*
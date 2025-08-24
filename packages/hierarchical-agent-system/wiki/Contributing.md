# Contributing Guide

We welcome contributions from the community! This guide will help you get started contributing to the CAIA Hierarchical Agent System.

---

## 🎆 Quick Start

### 1. Fork and Clone

```bash
# Fork the repository on GitHub, then:
git clone https://github.com/your-username/hierarchical-agent-system.git
cd hierarchical-agent-system
```

### 2. Development Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test

# Start development mode
npm run dev
```

### 3. Make Your Changes

```bash
# Create a feature branch
git checkout -b feature/your-feature-name

# Make your changes
# ...

# Run tests and linting
npm run test
npm run lint

# Commit your changes
git add .
git commit -m "feat: add your feature description"

# Push and create PR
git push origin feature/your-feature-name
```

---

## 🛠️ Development Environment

### Prerequisites

- **Node.js**: 18.0.0 or higher
- **npm**: 8.0.0 or higher (or pnpm/yarn)
- **Git**: Latest version
- **TypeScript**: 5.0.0 or higher

### IDE Setup

**VS Code Extensions (Recommended)**:
```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-next",
    "esbenp.prettier-vscode",
    "ms-vscode.vscode-eslint",
    "ms-vscode.vscode-json",
    "bradlc.vscode-tailwindcss",
    "ms-vscode.test-adapter-converter"
  ]
}
```

### Project Structure

```
hierarchical-agent-system/
├── src/                     # Source code
│   ├── agents/             # Agent implementations
│   ├── orchestration/      # Workflow management
│   ├── integrations/       # External integrations
│   ├── intelligence/       # AI/ML components
│   └── testing/            # Test utilities
├── tests/                  # Test files
│   ├── unit/               # Unit tests
│   ├── integration/        # Integration tests
│   └── e2e/                # End-to-end tests
├── docs/                   # Documentation
├── scripts/                # Build and utility scripts
└── wiki/                   # Wiki documentation
```

---

## 🔄 Development Workflow

### Branch Strategy

We use **GitHub Flow** with feature branches:

- `main`: Production-ready code
- `feature/*`: New features
- `fix/*`: Bug fixes
- `docs/*`: Documentation updates
- `refactor/*`: Code refactoring

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `perf`: Performance improvements
- `ci`: CI/CD changes

**Examples**:
```bash
git commit -m "feat(decomposer): add support for custom quality gates"
git commit -m "fix(jira): resolve authentication timeout issue"
git commit -m "docs: update API reference with new methods"
```

---

## 🧪 Types of Contributions

### 1. 🔧 Code Contributions

#### New Features
- Task decomposition improvements
- JIRA integration enhancements
- Intelligence analysis features
- Performance optimizations
- New integrations (Azure DevOps, Linear, etc.)

#### Bug Fixes
- Error handling improvements
- Performance issues
- Integration reliability
- Edge case handling

#### Example: Adding a New Feature

```typescript
// src/agents/task-decomposer/enhancers/SecurityAnalyzer.ts
export class SecurityAnalyzer {
  async analyzeSecurityRequirements(
    hierarchy: TaskHierarchy
  ): Promise<SecurityAnalysis> {
    // Implementation here
    return {
      securityTasks: [],
      riskLevel: 'medium',
      recommendations: []
    };
  }
}

// Add corresponding tests
// tests/unit/agents/SecurityAnalyzer.test.ts
describe('SecurityAnalyzer', () => {
  it('should identify security tasks', async () => {
    // Test implementation
  });
});
```

### 2. 📚 Documentation

- API documentation
- Tutorials and examples
- Architecture guides
- Wiki pages
- Code comments

#### Documentation Standards

```typescript
/**
 * Processes a project idea into a hierarchical task structure
 * 
 * @param options - Configuration options for processing
 * @param options.idea - The main project description
 * @param options.context - Additional context information
 * @param options.projectKey - JIRA project key (optional)
 * @returns Promise resolving to processing results
 * 
 * @example
 * ```typescript
 * const results = await system.processProject({
 *   idea: "Build a todo application",
 *   context: "React frontend, Node.js backend",
 *   projectKey: "TODO"
 * });
 * ```
 */
async processProject(options: ProcessProjectOptions): Promise<ProjectResults> {
  // Implementation
}
```

### 3. 🧪 Testing

- Unit tests
- Integration tests
- End-to-end tests
- Performance tests
- Load testing

#### Testing Guidelines

```typescript
// Unit test example
describe('TaskDecomposer', () => {
  let decomposer: TaskDecomposer;
  
  beforeEach(() => {
    decomposer = new TaskDecomposer();
  });
  
  describe('decomposeEnhanced', () => {
    it('should decompose simple idea into hierarchy', async () => {
      const result = await decomposer.decomposeEnhanced(
        'Build a simple blog'
      );
      
      expect(result.epics).toHaveLength(1);
      expect(result.stories.length).toBeGreaterThan(0);
      expect(result.confidenceScore).toBeGreaterThan(0.7);
    });
    
    it('should handle complex enterprise projects', async () => {
      const result = await decomposer.decomposeEnhanced(
        'Build microservices e-commerce platform',
        'High scalability, multi-tenant, real-time analytics'
      );
      
      expect(result.epics.length).toBeGreaterThan(3);
      expect(result.confidenceScore).toBeGreaterThan(0.8);
    });
  });
});
```

### 4. 📊 Performance Improvements

- Algorithm optimizations
- Memory usage improvements
- Network request optimization
- Parallel processing enhancements

### 5. 🔌 Integration Development

- New platform integrations
- API enhancements
- Webhook support
- Third-party tool connections

---

## 📋 Code Standards

### TypeScript Guidelines

```typescript
// Use strict typing
interface ProcessOptions {
  idea: string;
  context?: string;
  projectKey?: string;
}

// Prefer explicit return types
async function processProject(
  options: ProcessOptions
): Promise<ProjectResults> {
  // Implementation
}

// Use meaningful variable names
const decompositionResults = await taskDecomposer.process(idea);
const intelligenceAnalysis = await intelligenceHub.analyze(decompositionResults);

// Document complex logic
/**
 * Calculates confidence score using weighted factors:
 * - Requirement clarity (40%)
 * - Technical feasibility (30%) 
 * - Team experience (20%)
 * - Risk assessment (10%)
 */
private calculateConfidenceScore(factors: ConfidenceFactors): number {
  // Implementation with clear logic
}
```

### Code Quality Tools

```json
// .eslintrc.json
{
  "extends": [
    "@typescript-eslint/recommended",
    "prettier"
  ],
  "rules": {
    "@typescript-eslint/explicit-function-return-type": "error",
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": "error"
  }
}

// prettier.config.js
module.exports = {
  semi: true,
  trailingComma: 'es5',
  singleQuote: true,
  printWidth: 80,
  tabWidth: 2,
  useTabs: false
};
```

---

## 🧪 Pull Request Process

### Before Submitting

1. **Run the full test suite**:
   ```bash
   npm run test:all
   npm run lint
   npm run typecheck
   ```

2. **Update documentation** if needed

3. **Add tests** for new functionality

4. **Follow commit conventions**

### PR Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Performance improvement

## Testing
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual testing completed
- [ ] Performance impact assessed

## Documentation
- [ ] Code comments updated
- [ ] API documentation updated
- [ ] Wiki pages updated (if needed)
- [ ] Examples updated (if needed)

## Checklist
- [ ] Code follows project standards
- [ ] Self-review completed
- [ ] Breaking changes documented
- [ ] Related issues referenced
```

### Review Process

1. **Automated Checks**: CI pipeline runs automatically
2. **Code Review**: At least one maintainer reviews
3. **Testing**: Changes are tested in isolation
4. **Approval**: Approved PRs are merged by maintainers

---

## 🎨 Design Guidelines

### Architecture Principles

- **Separation of Concerns**: Each component has a single responsibility
- **Dependency Injection**: Use dependency injection for testability
- **Error Handling**: Comprehensive error handling with recovery
- **Performance**: Optimize for speed and memory efficiency
- **Extensibility**: Design for future enhancements

### API Design

```typescript
// Good: Clear, typed interfaces
interface CreateProjectOptions {
  idea: string;
  context?: string;
  teamSize?: number;
  timeline?: number;
  enableJira?: boolean;
}

// Good: Consistent naming
class ProjectProcessor {
  async processProject(options: CreateProjectOptions): Promise<ProjectResults> {}
  async analyzeProject(id: string): Promise<AnalysisResults> {}
  async exportProject(id: string, format: ExportFormat): Promise<string> {}
}

// Good: Error handling
try {
  const results = await processor.processProject(options);
  return results;
} catch (error) {
  if (error instanceof ValidationError) {
    throw new ProcessingError('Invalid project options', error);
  }
  throw error;
}
```

---

## 📋 Issue Guidelines

### Bug Reports

```markdown
**Bug Description**
Clear description of the bug

**Steps to Reproduce**
1. Run command: `caia-hierarchical process "test"`
2. See error: ...

**Expected Behavior**
What should have happened

**Actual Behavior**
What actually happened

**Environment**
- OS: macOS 12.0
- Node.js: 18.15.0
- Package Version: 1.0.0

**Additional Context**
Screenshots, logs, etc.
```

### Feature Requests

```markdown
**Feature Description**
Clear description of the proposed feature

**Use Case**
Why is this feature needed?

**Proposed Solution**
How could this be implemented?

**Alternatives Considered**
Other approaches you've considered

**Impact**
- Performance impact
- Breaking changes
- Documentation needs
```

---

## 🌟 Recognition

We value all contributions and recognize contributors in multiple ways:

### Contributor Recognition

- **Contributors List**: All contributors listed in README
- **Release Notes**: Significant contributions mentioned in releases
- **Hall of Fame**: Outstanding contributors featured prominently
- **Swag**: Stickers and swag for regular contributors

### Becoming a Maintainer

Active contributors may be invited to become maintainers based on:

- Consistent, high-quality contributions
- Deep understanding of the codebase
- Helpful community participation
- Alignment with project values

---

## 💬 Community

### Communication Channels

- **GitHub Discussions**: General questions and ideas
- **Discord**: Real-time chat and support
- **Issues**: Bug reports and feature requests
- **Email**: Sensitive issues (security@caia.dev)

### Community Guidelines

- **Be Respectful**: Treat everyone with respect
- **Be Helpful**: Help others learn and grow
- **Be Constructive**: Provide constructive feedback
- **Be Patient**: Remember we're all learning

---

## 🚀 Getting Started Projects

### Good First Issues

- Documentation improvements
- Adding example projects
- Writing tests for existing code
- Fixing small bugs
- Improving error messages

### Medium Complexity

- Adding new integrations
- Performance optimizations
- New CLI commands
- Enhanced error handling

### Advanced Projects

- New intelligence analysis features
- Architecture improvements
- Advanced JIRA features
- Machine learning enhancements

---

## 🔗 Useful Links

- [GitHub Repository](https://github.com/caia-team/hierarchical-agent-system)
- [NPM Package](https://www.npmjs.com/package/@caia/hierarchical-agent-system)
- [Discord Community](https://discord.gg/caia-dev)
- [Project Wiki](https://github.com/caia-team/hierarchical-agent-system/wiki)
- [API Documentation](https://docs.caia.dev/hierarchical-agent-system)

---

Thank you for contributing to the CAIA Hierarchical Agent System! Your contributions help make AI-powered project management accessible to everyone. 🎆
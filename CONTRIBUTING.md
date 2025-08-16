# Contributing to CAIA

Thank you for your interest in contributing to CAIA! We're building the future of automated intelligence together.

## 🎯 How to Contribute

### 1. Types of Contributions

- **New Agents**: Specialized AI agents for specific tasks
- **Engines**: Processing engines for various operations  
- **Utilities**: Reusable utility functions
- **Modules**: Business domain modules
- **Bug Fixes**: Help us squash bugs
- **Documentation**: Improve our docs
- **Examples**: Create usage examples

### 2. Getting Started

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/caia.git
cd caia

# Install dependencies
npm install
npm run bootstrap

# Create your feature branch
git checkout -b feature/amazing-agent
```

### 3. Creating New Components

#### New Agent
```bash
npm run create:agent my-agent
```

This creates:
```
agents/category/my-agent/
├── package.json
├── src/index.ts
├── README.md
└── __tests__/
```

#### New Utility
```bash
npm run create:util my-util
```

#### New Engine
```bash
npm run create:engine my-engine
```

### 4. Development Guidelines

#### Code Style
- TypeScript with strict mode
- Functional programming preferred
- Clear, descriptive naming
- Comprehensive JSDoc comments

#### Testing
- Write tests for all features
- Aim for 80%+ coverage
- Use descriptive test names

#### Documentation
- Update README for your component
- Include usage examples
- Document all public APIs

### 5. Component Standards

Every component must:
- ✅ Have a clear, single purpose
- ✅ Include comprehensive tests
- ✅ Provide TypeScript types
- ✅ Include documentation
- ✅ Follow CAIA naming conventions
- ✅ Be independently valuable

### 6. Commit Messages

Follow conventional commits:
```
feat(agent-name): add new capability
fix(engine-name): resolve processing issue
docs(util-name): update API documentation
test(module-name): add integration tests
```

### 7. Pull Request Process

1. **Create PR** with clear description
2. **Link Issues** if applicable
3. **Pass CI** - all tests must pass
4. **Code Review** - address feedback
5. **Merge** - maintainer will merge

### PR Template:
```markdown
## Description
Brief description of changes

## Type of Change
- [ ] New Agent
- [ ] New Engine
- [ ] New Utility
- [ ] Bug Fix
- [ ] Documentation

## Testing
- [ ] Tests pass locally
- [ ] Added new tests
- [ ] Coverage maintained/improved

## Checklist
- [ ] Follows code style
- [ ] Documentation updated
- [ ] No breaking changes
```

## 🏗️ Architecture Guidelines

### Agent Structure
```typescript
export class MyAgent extends BaseAgent {
  name = 'my-agent';
  version = '1.0.0';
  
  async execute(input: AgentInput): Promise<AgentOutput> {
    // Implementation
  }
}
```

### Engine Structure
```typescript
export class MyEngine extends BaseEngine {
  name = 'my-engine';
  version = '1.0.0';
  
  async process(input: EngineInput): Promise<EngineOutput> {
    // Implementation
  }
}
```

### Utility Structure
```typescript
export function myUtility(input: any): any {
  // Pure function implementation
}
```

## 📦 Package Naming

- Agents: `@caia/agent-{name}`
- Engines: `@caia/engine-{name}`
- Utils: `@caia/util-{name}`
- Modules: `@caia/module-{name}`

## 🧪 Testing

```bash
# Test all packages
npm run test:all

# Test specific package
npm run test -- @caia/agent-my-agent

# Test with coverage
npm run test:coverage
```

## 📚 Documentation

Each component needs:
1. **README.md** - Overview and usage
2. **API.md** - Detailed API documentation
3. **EXAMPLES.md** - Usage examples

## 🚀 Release Process

We use automated releases:
1. Merge to main triggers CI
2. Lerna detects changes
3. Automatic version bump
4. Publish to npm
5. GitHub release created

## 💬 Community

- **Discord**: [Join our server](https://discord.gg/caia)
- **Discussions**: Use GitHub Discussions
- **Issues**: Report bugs and request features

## 🎖️ Recognition

Contributors are recognized in:
- README.md contributors section
- GitHub contributors page
- Monthly community highlights
- Annual contributors summit

## 📝 License

By contributing, you agree that your contributions will be licensed under MIT.

## 🙏 Thank You!

Every contribution makes CAIA better. Together, we're building the future of automated intelligence!

---

**Questions?** Ask in [Discord](https://discord.gg/caia) or [Discussions](https://github.com/caia-ai/caia/discussions)
# Contributing to SATS

Thank you for your interest in contributing to SATS (Smart Agents Training System)! This guide will help you get started.

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## How to Contribute

### Reporting Issues

- Use the GitHub issue tracker
- Check existing issues before creating new ones
- Provide detailed information about bugs
- Include steps to reproduce issues

### Suggesting Features

- Use the feature request template
- Explain the use case and benefits
- Provide examples where possible

### Development Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/your-username/sats-agents-system.git
   cd sats-agents-system
   ```
3. Install dependencies:
   ```bash
   npm install
   ```
4. Create a `.env` file from `.env.example`
5. Start development services:
   ```bash
   docker-compose up -d
   npm run dev
   ```

### Pull Requests

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Make your changes
3. Write tests for new functionality
4. Ensure all tests pass:
   ```bash
   npm run test
   ```
5. Run linting and formatting:
   ```bash
   npm run lint
   npm run format
   ```
6. Commit using conventional commits:
   ```bash
   git commit -m "feat: add super intelligent feature"
   ```
7. Push to your fork and create a PR

## Development Guidelines

### Code Style

- Use TypeScript with strict mode
- Follow the existing code style
- Use meaningful variable and function names
- Add JSDoc comments for public APIs
- Keep functions small and focused

### Testing

- Write unit tests for new features
- Maintain high test coverage (>80%)
- Use descriptive test names
- Mock external dependencies

### Documentation

- Update README.md if needed
- Add API documentation for new features
- Include code examples
- Keep docs up to date

## Project Structure

```
src/
├── core/           # Core system components
├── agents/         # Agent implementations
├── models/         # LLM provider integrations
├── utils/          # Utility functions
└── types/          # TypeScript definitions
```

## Commit Convention

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New features
- `fix:` - Bug fixes
- `docs:` - Documentation changes
- `style:` - Code style changes
- `refactor:` - Code refactoring
- `test:` - Test additions or fixes
- `chore:` - Maintenance tasks

## Release Process

1. Releases are automated via GitHub Actions
2. Version bumps follow semantic versioning
3. Changelog is automatically generated
4. NPM packages are published automatically

## Getting Help

- Join our [Discord community](https://discord.gg/sats)
- Check the [documentation](https://docs.sats.ai)
- Open a GitHub Discussion

## Recognition

Contributors will be recognized in our README and release notes.

Thank you for contributing to SATS!
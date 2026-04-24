# Contributing to CAIA

Thanks for your interest in contributing!

## Development Setup

```bash
git clone https://github.com/prakashgbid/caia.git
cd caia
pnpm install
pnpm build
pnpm test
```

## Commit Convention

This repo follows [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): subject

feat(logger): add structured context support
fix(errors): correct stack trace serialisation
docs(cli): update new utility command example
```

Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `perf`, `ci`

## Changesets

Every code change that affects a published package needs a changeset:

```bash
pnpm changeset        # interactive prompt
```

Choose the packages affected, bump type (patch/minor/major), and write a summary.
PRs without changesets for affected packages will fail CI.

## Pull Requests

1. Fork the repo and create a branch: `git checkout -b feat/my-feature`
2. Make your changes with tests
3. Run `pnpm test && pnpm typecheck && pnpm lint`
4. Add a changeset if applicable
5. Open a PR against `main`

All PRs require CI green before merge.

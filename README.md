# CAIA — Chief AI Agent

> Foundational utilities, CLI, and templates for AI-driven application development.

[![CI](https://github.com/prakashgbid/caia/actions/workflows/ci.yml/badge.svg)](https://github.com/prakashgbid/caia/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Philosophy

CAIA is an **opinionated ecosystem** for building AI-native applications. Every package is:

- **Typed first** — strict TypeScript, no `any`, complete API contracts
- **Framework-agnostic** — utilities have no dependency on frameworks or sites
- **Observable by default** — logging, tracing, and metrics are built-in, not bolted on
- **Test-friendly** — every package ships a matching test-kit with mocks and fixtures

The ecosystem is organised in tiers:

| Tier | Purpose | Packages |
|------|---------|----------|
| 1 | Foundational infrastructure | `logger`, `events`, `metrics`, `tracing`, `errors`, `config`, `secrets`, `test-kit` |
| 2 | Domain utilities | TBD |
| 3 | AI agent primitives | TBD |
| 4 | Orchestration / CAIA core | TBD |
| 5 | Site scaffolds | `templates/site` → separate repos |

All packages are published under the **`@chiefaia`** npm scope.

---

## Packages

### Tier 1 — Infrastructure

| Package | Version | Description |
|---------|---------|-------------|
| [`@chiefaia/logger`](packages/logger) | 0.1.0 | Structured logging (Pino-backed) |
| [`@chiefaia/events`](packages/events) | 0.1.0 | Typed event bus |
| [`@chiefaia/metrics`](packages/metrics) | 0.1.0 | Prometheus-compatible metrics |
| [`@chiefaia/tracing`](packages/tracing) | 0.1.0 | OpenTelemetry tracing |
| [`@chiefaia/errors`](packages/errors) | 0.1.0 | Typed error hierarchy |
| [`@chiefaia/config`](packages/config) | 0.1.0 | Validated runtime configuration |
| [`@chiefaia/secrets`](packages/secrets) | 0.1.0 | Secret management client |
| [`@chiefaia/test-kit`](packages/test-kit) | 0.1.0 | Test utilities and mocks |

### CLI

| Package | Version | Description |
|---------|---------|-------------|
| [`@chiefaia/cli`](packages/cli) | 0.1.0 | `caia` — scaffold utilities, sites, and agents |

### Shared Configs

| Package | Description |
|---------|-------------|
| [`@chiefaia/eslint-config`](configs/eslint-config) | Shared ESLint configuration |
| [`@chiefaia/tsconfig`](configs/tsconfig) | Shared TypeScript configuration |
| [`@chiefaia/vitest-config`](configs/vitest-config) | Shared Vitest configuration |

---

## Getting Started

```bash
# Install the CLI globally
npm install -g @chiefaia/cli

# Scaffold a new utility package inside your own CAIA monorepo
caia new utility my-utility

# Scaffold a standalone Tier-5 site repo
caia new site my-site --domain my-site.com

# Check a repo for CAIA compliance
caia doctor
```

---

## Development

This monorepo uses [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build/).

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint
```

### Releasing

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing.

```bash
# Create a changeset for your change
pnpm changeset

# Apply pending changesets (bumps versions + updates changelogs)
pnpm version

# Publish to npm (CI does this automatically on merge to main)
pnpm release
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Security

See [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Prakash Tiwari

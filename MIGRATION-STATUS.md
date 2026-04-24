# Migration Status

Tracks the journey of each package from stub → real implementation → published.

## Tier 1 — Infrastructure

| Package | Status | Notes |
|---------|--------|-------|
| `@chiefaia/logger` | ✅ ready | Pino backend, string-level formatter, child contexts, 11 tests |
| `@chiefaia/events` | ✅ ready | Pure EventBus, on/off/emit/once, 10 tests |
| `@chiefaia/metrics` | ✅ ready | prom-client Registry + local value mirrors, Counter/Gauge/Histogram, Prometheus text render, 4 tests |
| `@chiefaia/tracing` | ✅ ready | OTel SDK backend (trace.getTracer), withSpan context manager, 4 tests |
| `@chiefaia/errors` | ✅ ready | Full hierarchy (CaiaError/Validation/NotFound/Unauthorized/Configuration), 21 tests |
| `@chiefaia/config` | ✅ ready | Zod v4 overload added (backward-compatible with record schema), 12 tests |
| `@chiefaia/secrets` | ✅ ready | FileVaultAdapter (JSON file at VAULT_PATH) + MemorySecretsAdapter, 16 tests |
| `@chiefaia/test-kit` | ✅ ready | createTestLogger/createSpyLogger/createTestEventBus/createTestSecretsClient/waitFor, 20 tests |

## CLI

| Package | Status | Notes |
|---------|--------|-------|
| `@chiefaia/cli` | 🌱 stub | Commander.js skeleton, new/doctor subcommands. Fixed parse() guard for test isolation. |

## Shared Configs

| Package | Status | Notes |
|---------|--------|-------|
| `@chiefaia/eslint-config` | ✅ ready | ESLint 8+, TS-eslint, boundary rules (warnings). |
| `@chiefaia/tsconfig` | ✅ ready | Strict ES2022/NodeNext baseline. |
| `@chiefaia/vitest-config` | ✅ ready | Coverage thresholds, node env. |

## Phase 2 Changes

### New dependencies added
- `@chiefaia/logger`: `pino` (prod), `pino-pretty`, `@types/node` (dev)
- `@chiefaia/metrics`: `prom-client` (prod)
- `@chiefaia/tracing`: `@opentelemetry/api`, `@opentelemetry/sdk-node` (prod)
- `@chiefaia/config`: `zod` (prod), `@types/node` (dev)
- `@chiefaia/secrets`: `@types/node` (dev)
- `@chiefaia/test-kit`: `@types/node` (dev)

### Blockers
- **NPM_TOKEN** secret not configured in repo → `changeset publish` will fail until set
- Peer dependency warnings: `@typescript-eslint/*` expects ESLint `^8.56.0` but found `10.x` (non-blocking)

## Status Key

| Icon | Meaning |
|------|---------|
| 🌱 stub | Typed API surface exists, tests pass, implementation is minimal |
| 🔨 migrating | Real implementation in progress |
| ✅ ready | Production-quality implementation, tests comprehensive |
| 📦 published | Available on npm |

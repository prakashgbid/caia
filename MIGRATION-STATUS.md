# Migration Status

Tracks the journey of each package from stub → real implementation → published.

## Tier 1 — Infrastructure

| Package | Status | Notes |
|---------|--------|-------|
| `@chiefaia/logger` | 🌱 stub | Typed API, 4 unit tests. Real: wire Pino. |
| `@chiefaia/events` | 🌱 stub | Typed API, 4 unit tests. Real: consider EventEmitter or BullMQ for distributed. |
| `@chiefaia/metrics` | 🌱 stub | Typed API, 4 unit tests. Real: wire prom-client. |
| `@chiefaia/tracing` | 🌱 stub | Typed API, 4 unit tests. Real: wire @opentelemetry/sdk-node. |
| `@chiefaia/errors` | 🌱 stub | Full hierarchy implemented. Ready for integration. |
| `@chiefaia/config` | 🌱 stub | Schema-based loading implemented. Real: add zod support. |
| `@chiefaia/secrets` | 🌱 stub | Adapter pattern in place. Real: wire SshFileVaultAdapter from @plugins/secrets-broker. |
| `@chiefaia/test-kit` | 🌱 stub | Helpers implemented. Grows as other packages ship mocks. |

## CLI

| Package | Status | Notes |
|---------|--------|-------|
| `@chiefaia/cli` | 🌱 stub | Commander.js skeleton, all subcommands registered. Real: implement scaffolding logic. |

## Shared Configs

| Package | Status | Notes |
|---------|--------|-------|
| `@chiefaia/eslint-config` | ✅ ready | ESLint 8+, TS-eslint, boundary rules (warnings). |
| `@chiefaia/tsconfig` | ✅ ready | Strict ES2022/NodeNext baseline. |
| `@chiefaia/vitest-config` | ✅ ready | Coverage thresholds, node env. |

## Status Key

| Icon | Meaning |
|------|---------|
| 🌱 stub | Typed API surface exists, tests pass, implementation is minimal |
| 🔨 migrating | Real implementation in progress |
| ✅ ready | Production-quality implementation, tests comprehensive |
| 📦 published | Available on npm |

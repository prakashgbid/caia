# Introduction

CAIA (**C**hief **A**I **A**gent) is an opinionated ecosystem of foundational utilities for building AI-native applications.

## Philosophy

Every package in CAIA follows the same contract:

1. **Typed first** — strict TypeScript with no `any`. Every public API has complete type signatures.
2. **Framework-agnostic** — no dependency on Next.js, NestJS, Express, or any other framework. Use alongside anything.
3. **Observable by default** — `@chiefaia/logger`, `@chiefaia/tracing`, and `@chiefaia/metrics` ship as first-class utilities, not afterthoughts.
4. **Test-friendly** — every package ships a matching test helper in `@chiefaia/test-kit`.

## Tier System

| Tier | Purpose | Examples |
|------|---------|---------|
| **1** | Infrastructure | `logger`, `events`, `metrics`, `tracing`, `errors`, `config`, `secrets`, `test-kit` |
| **2** | Domain utilities | Coming in Phase 2 |
| **3** | AI agent primitives | Coming in Phase 3 |
| **4** | Orchestration / CAIA core | Coming in Phase 4 |
| **5** | Site scaffolds | `templates/site` → separate repos |

## npm Scope

All packages are published under `@chiefaia` on npm.

```bash
pnpm add @chiefaia/logger @chiefaia/errors
```

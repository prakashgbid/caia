# @caia/database-architect

Architect #3 of CAIA's 17-architect EA fan-out. Senior DBA / data architect focused on Postgres 16 + Drizzle/Prisma migrations + per-tenant schema isolation. Reads Backend Architect's `apiEndpoints` to know what data needs to be persisted; emits table schemas, indexes, migration plans, and tenant-isolation rules.

Mirrors the canonical `@caia/frontend-architect` template (architect #1).

## What it owns

`database.*` slice of the `tickets.architecture` JSONB column:

- `database.engine` — locked Postgres 16 + Drizzle ORM (Prisma allowed when ticket flags it)
- `database.tables` — table definitions (name, primary key, comment, scope)
- `database.columns` — per-table column specs (type, nullability, default, check)
- `database.indexes` — index specs including GIN on JSONB query paths
- `database.migrations` — additive-only migration plan (up/down DDL, ordering)
- `database.relationships` — FK constraints, cascade rules, relationship graph
- `database.rlsPolicies` — Row-Level Security policies per table
- `database.tenantIsolationStrategy` — schema-per-tenant model (matches CAIA meta cluster)
- `database.dataLifecycle` — retention, archival, GDPR delete patterns per table
- `database.jsonbShapes` — Zod-style descriptors for every JSONB column
- `database.queryHints` — read/write access patterns derived from Backend's endpoints

## What it does NOT do

No API endpoints (Backend Architect owns those). No UI (Frontend Architect owns that). No auth flows (Security Architect owns those). No event taxonomy (Analytics). No CSP. Other architects own those concerns and the contract rejects out-of-namespace writes.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1 + §2.3). The EA Dispatcher spawns one of these per applicable ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Reads Backend's upstream output (`backend.endpointEnumeration` + `backend.dataAccess`) to know what data needs to be persisted. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

**Dependencies:** depends on `backend` (wave-2 architect).

## Quick start

```ts
import { DatabaseArchitect, DatabaseArchitectContract } from '@caia/database-architect';

const architect = new DatabaseArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { backend: backendOutput } },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness (no overlap with `@caia/frontend-architect`), output validation, `run()` idempotency, dependency declaration, cross-architect invariants, and an end-to-end golden test against a known prakash-tiwari contact-form Story ticket.

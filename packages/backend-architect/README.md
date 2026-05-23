# @caia/backend-architect

Architect #2 of CAIA's 17-architect EA fan-out. Senior backend engineer focused on Next.js 15 App Router Route Handlers + Server Actions + TypeScript + Zod v3 + Cloudflare Access + Drizzle ORM. Produces tight API endpoint specs the coding worker can implement directly. Wave-1 architect (no upstream deps); Database/Security/API-Gateway/Observability/DevOps Architects all depend on Backend's output downstream.

Mirrors the canonical `@caia/frontend-architect` template (architect #1).

## What it owns

`backend.*` slice of the `tickets.architecture` JSONB column:

- `backend.framework` — locked Next.js 15 App Router (Route Handlers + Server Actions), hybrid edge+node runtime
- `backend.serviceBoundaries` — module decomposition (default monolith-with-modules)
- `backend.apiEndpoints` — per-ticket endpoint specs (method, path, schemas, persistence, auth, rate limit)
- `backend.endpointEnumeration` — flat `{route, table, op}` enumeration consumed by Database Architect
- `backend.requestSchemas` — Zod v3 request body / query schemas keyed by ref
- `backend.responseSchemas` — Zod v3 response body schemas keyed by ref
- `backend.errorEnvelope` — canonical error envelope shape + examples + class-to-status mapping
- `backend.validationRules` — cross-cutting validation invariants beyond Zod
- `backend.authRequirements` — per-endpoint auth (default Cloudflare Access for tenant routes)
- `backend.rateLimits` — per-endpoint rate limits (per-tenant/per-IP)
- `backend.dataAccess` — ORM choice + per-table query plan (consumed by Database Architect)
- `backend.businessRules` — cross-cutting business invariants surfaced to downstream architects

## What it does NOT do

No frontend components (Frontend Architect owns those — merged PR #537). No database migrations (Database Architect owns those — merged PR #549). No CSP/authN/authZ (Security). No event taxonomies (Analytics). No CI/CD (DevOps). Other architects own those concerns and the contract rejects out-of-namespace writes.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1 + §2.2). The EA Dispatcher spawns one of these per applicable ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Reads `ticket`, `businessPlan`, `designVersion` directly; Backend is wave-1 so `upstream.outputs` is empty on first run. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

**Dependencies:** none (wave-1 architect).
**Precedence rank:** 12 per spec §5.2.
**Applies to:** Page, Story, Form, List, Foundation tickets; Widget tickets only when tagged `api`/`backend`/`persists`.

## Quick start

```ts
import { BackendArchitect, BackendArchitectContract } from '@caia/backend-architect';

const architect = new BackendArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: {} },
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

The test suite includes interface compliance, contract structural checks, registration disjointness (no overlap with `@caia/frontend-architect` or `@caia/database-architect`), output validation, `run()` idempotency, dependency declaration, cross-architect invariants, and an end-to-end golden test against a known prakash-tiwari ArtistContactForm Widget ticket.

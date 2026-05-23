# @caia/frontend-architect

Architect #1 of CAIA's 17-architect EA fan-out. This package is the **canonical template** the other 16 architect packages follow.

## What it owns

`frontend.*` slice of the `tickets.architecture` JSONB column:

- `frontend.framework` — locked Next.js 15 App Router
- `frontend.componentLibrary` — locked shadcn/ui + Tailwind
- `frontend.stateMgmt` — server-first; zustand for client state
- `frontend.routeConfig` — App Router segment placement
- `frontend.tokens` — design tokens lifted verbatim from intake IR
- `frontend.breakpoints` — responsive breakpoints
- `frontend.a11yFloor` — UI-author intent (semantic elements, tab-order)
- `frontend.motionPreference` — `prefers-reduced-motion` contract
- `frontend.componentTree` — canonical component composition
- `frontend.propsContract` — TypeScript props per component
- `frontend.stateModel` — per-component state model
- `frontend.designTokenReferences` — per-component token consumption
- `frontend.a11yNotesForUI` — UI-author a11y intent
- `frontend.routingNotes` — App Router specifics
- `frontend.interactionStates` — hover/focus/active/error/empty/loading/disabled per component

## What it does NOT do

No database code. No API endpoints. No test specs. No CSP rules. Other architects own those concerns and the contract rejects out-of-namespace writes.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1). The EA Dispatcher spawns one of these per applicable ticket. Each spawn calls `@chiefaia/claude-spawner` (subscription-only, no API-key billing) with Sonnet default. Returns a structured `ArchitectOutput` the Dispatcher composes into the ticket's `architecture` JSONB.

## Quick start

```ts
import { FrontendArchitect, FrontendArchitectContract } from '@caia/frontend-architect';

const architect = new FrontendArchitect();
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

The test suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration, cross-architect invariants, and an end-to-end golden test against a known prakash-tiwari Widget ticket.

## Template notes (for the other 16 architects)

When porting this package to architect #2 (Backend), #3 (Database), etc:

1. Copy the package layout verbatim.
2. Replace every `frontend.*` field path with the new architect's namespace.
3. Update `architectMeta.precedenceLevel` per spec §5.2.
4. Update `architectMeta.dependsOn` per spec §2.x — Backend is wave-1 with `[]`; Database is wave-2 with `['backend']`; A11y is wave-2 with `['frontend']`; etc.
5. Rewrite the system prompt's "Role" + "Locked stack" + per-field guidance.
6. Build a new golden fixture for that architect's owned fields.
7. Mirror the test suite — interface compliance + contract + system prompt + run + validation + invariants + golden.

The `SpecialistArchitect`, `ArchitectInput`, `ArchitectOutput`, and `ArchitectContract` types live in `src/types.ts` and should eventually move to `@caia/architect-kit` (sibling task). Until then, each architect package re-exports them.

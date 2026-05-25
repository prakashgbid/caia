# `@caia/grand-idea`

Stage 2 of the canonical CAIA pipeline. Captures the founder's "grand
idea" prompt, persists it to a per-tenant Postgres table, and advances
the project FSM from `onboarding → idea-captured` so the Interviewer
Agent (Stage 3) can spawn.

```
Stage 1   @caia/onboarding       → tenant + secrets
Stage 2   @caia/grand-idea       ← THIS PACKAGE
            FSM: onboarding → idea-captured
            writes: caia_<tenant>.grand_ideas
Stage 3   @caia/interviewer      → BusinessPlanV2
```

## Surface

```ts
import {
  GrandIdeaPersistence,
  MemoryGrandIdeaPersistence,
  createCaptureHandler,
  StaticAccessVerifier,
  GrandIdeaForm,           // from '@caia/grand-idea/ui-component'
  advanceToIdeaCaptured,
} from '@caia/grand-idea';
```

## Persistence

- One table per tenant: `caia_<short>.grand_ideas`
- Immutable rows; each new capture bumps `revision_number`
- 5..5000 word floor + ceiling enforced both at the DB CHECK and the
  zod schema layer
- `LISTEN/NOTIFY` trigger fires `grand_idea_captured` for the dashboard
  SSE listener

Migration template: `migrations/001_grand_ideas.sql`. The
`{{SCHEMA}}` placeholder is substituted by `GrandIdeaPersistence` at
`ensureSchema()` time. To run manually:

```sql
\set schema 'caia_pt'
\i 001_grand_ideas.sql   -- after sed-style substitution of {{SCHEMA}}
```

## API handler

Transport-agnostic. Takes `(body, headers)`, returns `{status, body}`.

```ts
const handler = createCaptureHandler({
  persistence: new GrandIdeaPersistence({ pgPool, tenantSchema: 'caia_pt' }),
  stateMachine,
  accessVerifier: cloudflareAccessVerifier, // verifies CF Access JWT
});

// Wire to your route:
//   POST /api/grand-idea   { tenantSlug, projectId, prompt }
// →  201 { ok: true, grandIdeaId, revisionNumber, newState: 'idea-captured' }
// →  400 { ok: false, error: 'validation_failed', ... }
// →  401/403 { ok: false, error: 'auth_missing'|'auth_invalid', ... }
// →  404 { ok: false, error: 'tenant_not_found', ... }
// →  409 { ok: false, error: 'tenant_not_onboarded'|'project_state_invalid', ... }
// →  500 { ok: false, error: 'persistence_failed'|'fsm_transition_failed', ... }
```

## UI component

A React functional component matching the visual language of
`apps/admin/components/Wizard.tsx` (inline styles, neutral palette,
plain HTML primitives). "shadcn-aligned" is satisfied by visual
cohesion, not by importing `@shadcn/ui` runtime.

```tsx
import { GrandIdeaForm } from '@caia/grand-idea/ui-component';

<GrandIdeaForm
  tenantSlug="prakash-tiwari"
  projectId="<project-uuid>"
  onCaptured={(r) => router.push(`/project/${r.grandIdeaId}/interview`)}
/>;
```

## FSM integration

```ts
import { advanceToIdeaCaptured } from '@caia/grand-idea/state-machine';

await advanceToIdeaCaptured(stateMachine, {
  projectId,
  triggeredById: 'founder@example.com',
  triggeredByKind: 'operator',
});
```

The wrapper is idempotent: a repeat call on a project already in
`idea-captured` returns `applied: false` without throwing.

## Subscription-only

This package makes no LLM calls. It is pure I/O — Postgres write + FSM
transition + handler. No `@chiefaia/claude-spawner` import.

## Tests

```
pnpm --filter @caia/grand-idea test
```

≥ 20 vitest cases; ≥ 80% coverage via `@chiefaia/vitest-config` defaults.

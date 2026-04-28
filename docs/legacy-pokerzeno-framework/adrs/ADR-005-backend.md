# ADR-005: Backend Architecture

**Date**: 2026-04-10
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

Some sites need server-side logic that cannot be handled purely client-side:
- Saving user scores (must be authenticated, not fakeable from the client)
- Leaderboard aggregation (reading many rows efficiently)
- Site-specific configuration fetched at request time
- Email sending (quiz result summary, welcome email)

The constraint: `output: 'export'` in Next.js 15 means **API routes (`app/api/`) do not exist at runtime**. They cannot be used. Any backend logic must live outside the Next.js app.

---

## Decision

**Supabase Edge Functions** for all backend logic, accessed via `@pokerzeno/backend-core`.

Architecture:
- Client code calls `@pokerzeno/backend-core` functions (e.g., `saveScore(userId, quizId, score)`)
- `backend-core` calls the Supabase Edge Function URL via `fetch()`
- Edge Functions run Deno (TypeScript), have access to the `service_role` key, and execute RLS-bypassing queries when needed
- Auth: client sends the Supabase Auth JWT in the `Authorization` header; Edge Function verifies it before executing

```
Site (Next.js static) → @pokerzeno/backend-core → Supabase Edge Function → PostgreSQL
```

Environment variables:
```
NEXT_PUBLIC_SUPABASE_URL=https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon]
# service_role key ONLY in Edge Functions, never in site code
```

For simple read operations that RLS covers (e.g., reading public leaderboard), the client can call the Supabase REST API directly via `backend-core` without going through an Edge Function.

---

## Consequences

**Positive**:
- No separate backend server to maintain — Edge Functions are deployed alongside the database
- Deno runtime in Edge Functions is TypeScript-native — no compilation step
- Edge Functions auto-scale; no capacity planning needed
- Keeps `service_role` key server-side only (Edge Functions environment, not browser)

**Negative / Trade-offs**:
- Supabase Edge Functions have cold start latency (~200-500ms on first invocation after idle). Mitigation: keep functions small and use caching headers where appropriate
- Edge Functions are Deno — not all Node.js packages work. We use only Deno-compatible packages in Edge Functions
- Debugging Edge Functions requires the Supabase CLI (`supabase functions serve` for local dev)

---

## Alternatives Considered

**Separate NestJS API** — rejected. A full NestJS service requires hosting (a VPS or container), a deploy pipeline, and operational monitoring. This is appropriate for Stolution (which has these requirements) but overkill for what are essentially CRUD operations on user scores. Cost and complexity scale linearly with the number of sites.

**Cloudflare Workers** — rejected. Would require learning another platform's edge runtime, managing Workers configuration, and paying for Workers invocations at scale. Supabase Edge Functions are free tier and colocated with the database.

**Vercel Serverless Functions** — rejected. We're not on Vercel (see ADR-002). Would create a split deployment: site on Cloudflare, functions on Vercel.

**Next.js API Routes** — cannot be used. `output: 'export'` removes them entirely. This is a hard constraint, not a preference.

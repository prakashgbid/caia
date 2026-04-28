# ADR-003: Data Storage and Backend Database

**Date**: 2026-04-10
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

Some PokerZeno sites need persistent storage for:
- User accounts (optional: email/password or OAuth)
- Leaderboards and quiz scores
- Saved user preferences (e.g., saved tips, bookmarked articles)
- Site-specific configuration (feature flags, content metadata)

Requirements:
- PostgreSQL or Postgres-compatible (relational data fits our schema better than NoSQL)
- Row Level Security (RLS) — users should only see their own data without application-layer filtering
- Generous free tier — can't pay per-site for a database until traffic justifies it
- Good TypeScript client
- Managed backups and failover (no self-hosted DBs)

---

## Decision

**Supabase** — managed PostgreSQL with built-in Auth, Row Level Security, and Edge Functions.

All database access in site code goes through `@pokerzeno/backend-core`. Sites MUST NOT import `@supabase/supabase-js` directly.

```typescript
// CORRECT — use the wrapper
import { getSupabaseClient, getUserScores } from '@pokerzeno/backend-core';

// WRONG — never do this in site code
import { createClient } from '@supabase/supabase-js';
```

The `@pokerzeno/backend-core` package:
- Creates the Supabase client with correct env vars
- Exposes typed query functions (no raw SQL in site code)
- Handles RLS policy compliance
- Provides consistent error handling and retry logic

Environment variables required in every site:
```
NEXT_PUBLIC_SUPABASE_URL=https://[project-ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=[anon-key]
```

The `service_role` key is NEVER used in site code — only in Edge Functions running server-side.

---

## Consequences

**Positive**:
- PostgreSQL gives us full relational modeling — foreign keys, joins, transactions
- RLS policies live in the database — security is enforced at the data layer, not the application layer
- Supabase Auth handles OAuth (Google, GitHub), magic links, and email/password with no custom implementation
- TypeScript types can be auto-generated from the schema: `supabase gen types typescript`
- Free tier: 500MB database, 5GB bandwidth, 50MB file storage per project — adequate for early-stage sites

**Negative / Trade-offs**:
- Free tier projects pause after 7 days of inactivity. Sites with low traffic need either a cron ping or a paid plan. Mitigation: `@pokerzeno/integrity-check` smoke test pings the Supabase health endpoint daily via GitHub Actions
- Supabase is still a managed service — we're dependent on their uptime. Accepted risk for the free tier benefit
- Migrating away from Supabase later would require rewriting `@pokerzeno/backend-core`. The abstraction layer makes this feasible but not trivial

---

## Alternatives Considered

**Firebase (Firestore)** — rejected. NoSQL document model is a poor fit for relational data (users, scores, site configs). The JavaScript SDK is large. Vendor lock-in to Google Cloud. Pricing is unpredictable at scale.

**PlanetScale** — rejected. MySQL, not PostgreSQL. The `output: 'export'` pattern means no server-side connection pooling — PlanetScale's HTTP driver would work but the TypeScript client is less mature than Supabase's.

**Neon** — considered but Supabase was chosen because it includes Auth, Storage, and Edge Functions in addition to the database. Neon is pure database — we'd need separate services for auth. Supabase as a platform is more appropriate.

**Self-hosted Postgres on VPS** — rejected. Requires backup strategy, connection pooling (PgBouncer), monitoring, SSL certificate management, and SSH access for schema migrations. Operational overhead scales linearly with site count.

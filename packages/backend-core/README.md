# @pokerzeno/backend-core

Shared Supabase backend for **RouletteCommunity** and **PokerZeno**. Provides typed client modules, PostgreSQL schema with RLS, and a full test suite.

## Quick Start

### 1. Create a Supabase Project

Go to [supabase.com](https://supabase.com) → New Project → Free tier.

Once created, copy from **Settings → API**:
- Project URL
- `anon` public key
- `service_role` secret key (keep this server-side only)

### 2. Configure Environment

```bash
cp .env.example .env
# Fill in your Supabase URL and keys
```

`.env`:
```
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# For Next.js apps (browser-safe):
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
```

### 3. Run Migrations

Apply all schema files in order using the Supabase dashboard SQL editor, or via CLI:

```bash
# With Supabase CLI (requires Docker for local dev)
supabase db push

# Or paste each file manually in Supabase SQL editor:
# schema/001_users.sql → 002 → 003 → ... → 009_marketplace.sql
# Then apply RLS files under schema/rls/
```

### 4. Install and Use

```bash
npm install  # or: pnpm install
```

In your Next.js or Node app (TypeScript):

```ts
import { auth, users, groups } from '@pokerzeno/backend-core'

const result = await auth.signUpWithEmail('user@example.com', 'password')
const profile = await users.getProfile(result.user!.id)
```

See `examples/` for full usage patterns.

---

## Modules

| Import path | What it does |
|---|---|
| `@pokerzeno/backend-core` | All modules re-exported |
| `@pokerzeno/backend-core/auth` | Sign up, sign in, magic link, OAuth, session |
| `@pokerzeno/backend-core/users` | Profile CRUD, settings, notifications |
| `@pokerzeno/backend-core/groups` | Create/join groups, memberships, queries |
| `@pokerzeno/backend-core/posts` | Threads, replies, reactions |
| `@pokerzeno/backend-core/publications` | Articles, research papers, editorial review |
| `@pokerzeno/backend-core/events` | Create events, RSVPs |
| `@pokerzeno/backend-core/points` | Award/deduct points, leaderboard, tier promotions |
| `@pokerzeno/backend-core/notifications` | Send, preferences, read/unread |
| `@pokerzeno/backend-core/follows` | Follow, mute, block, followers/following lists |
| `@pokerzeno/backend-core/types` | All TypeScript types |

---

## Schema Overview

| Table | Description |
|---|---|
| `profiles` | User profiles (auto-created on auth.users insert) |
| `groups` | Hierarchical community groups |
| `group_memberships` | User ↔ group with role (member/moderator/host) |
| `threads` | Discussion posts |
| `replies` | Threaded replies |
| `reactions` | Emoji reactions on threads/replies/articles |
| `articles` | Long-form editorial content |
| `research_papers` | Peer-reviewed research |
| `editorial_reviews` | Peer review verdicts |
| `events` | Community events with RSVP |
| `rsvps` | Event attendance |
| `points_ledger` | Append-only points ledger |
| `badges` | Achievement badges |
| `user_badges` | Badge awards |
| `tier_promotions` | Tier change audit log |
| `user_relationships` | Follow / mute / block |
| `delivered_notifications` | In-app notifications |
| `notification_preferences` | Per-user channel preferences |
| `marketplace_listings` | Product/service listings |
| `marketplace_orders` | Purchase orders |

RLS is enabled on all tables. Users can read public content and write only their own rows. Admin operations use `SUPABASE_SERVICE_ROLE_KEY`.

---

## User Tiers (Points-Based)

| Tier | Points Required |
|---|---|
| member | 0 |
| contributor | 100 |
| trusted | 500 |
| moderator | 2,000 |
| admin | 10,000 |

Points are awarded via `points.awardPoints(userId, reason, delta)`. The `checkAndPromote()` function handles automatic tier upgrades.

---

## Free-Tier Limits (Supabase)

Supabase free tier as of 2025:

| Resource | Free limit |
|---|---|
| Database | 500 MB |
| Bandwidth | 5 GB/month |
| Auth users | 50,000 MAUs |
| Storage | 1 GB |
| Edge Functions | 500,000 invocations/month |
| Realtime | 200 concurrent connections |
| Projects | 2 active projects |

**Things to watch:**
- `points_ledger` is append-only — rows grow fast with active users. Add periodic archiving after 100K rows.
- `delivered_notifications` should be pruned (soft-delete read notifications older than 90 days).
- `reactions` are per-user per-target — de-duplicate before inserting.

---

## Upgrade Path

When you hit free-tier limits:

1. **Pro plan ($25/month)**: 8 GB DB, 250 GB bandwidth, unlimited MAUs, 100 GB storage.
2. **Scale storage**: Enable `supabase_storage` for media uploads (avatars, hero images).
3. **Add read replicas**: For leaderboard/search-heavy queries.
4. **Move to self-hosted**: Use `supabase/supabase` Docker stack on a VPS — same schema/RLS, no cost ceiling.

---

## Running Tests

Tests skip gracefully when `SUPABASE_URL` is not set. For integration tests, use a real Supabase project or local Supabase:

```bash
# Unit + integration (requires SUPABASE_URL in .env.test)
npm test

# E2E full-flow
npm run test:e2e

# Type checking
npm run typecheck

# Watch mode
npm run test:watch
```

**Local Supabase** (Docker required):
```bash
supabase start          # starts local DB on :54321
supabase db push        # applies schema
npm test                # tests run against local instance
supabase stop
```

`.env.test` already has local Supabase defaults (anon and service-role demo keys).

---

## Next Steps for the Developer

1. **Create your Supabase project** at supabase.com (free tier).
2. **Run `scripts/init-supabase.sh`** or paste migrations manually in the SQL editor.
3. **Copy `.env.example` → `.env`** and fill in your URL + keys.
4. **Wire into your Next.js app** — see `examples/next-app-usage.ts`.
5. **Set up auth redirect** — in Supabase dashboard, add `http://localhost:3000/auth/callback` to allowed redirect URLs.

---

## License

Proprietary. See [LICENSE](./LICENSE).

# Stolution Codebase Analysis
**Date:** April 28, 2026  
**Purpose:** Strategic analysis to inform CAIA feature development for Stolution  
**Codebase:** `~/Documents/projects/stolution-fix/`

---

## 1. Full Project Structure

### Top-Level Directories

| Directory | Purpose |
|-----------|---------|
| `apps/api` | NestJS backend API (port 3001) |
| `apps/web` | Next.js production frontend (port 3000) |
| `apps/web-dev` | Next.js development instance (port 3004 / 8081) |
| `ai-search` | Elasticsearch integration & AI search services |
| `ai` | Python-based AI services (anomaly detection, embeddings, query parsing) |
| `config` | Nginx, SSL, Prometheus monitoring configs |
| `docs` | 30+ architectural documentation files |
| `scripts` | Data processing and ETL scripts |
| `monitoring` | Grafana, Prometheus, alerting setup |

### Services Map

| Service | Framework | Port | Purpose |
|---------|-----------|------|---------|
| API | NestJS 10.3 | 3001 | Main backend — TypeORM + PostgreSQL |
| Web (prod) | Next.js 14.2 | 3000 | Production frontend (PM2) |
| Web (dev) | Next.js 14.2 | 8081 | Development frontend |
| PostgreSQL | Docker | 5432 | Main database (115GB+) |
| Meilisearch | Docker | 7700 | Full-text search engine (201GB index) |
| Redis | Docker | 6379 | Cache & job queues |
| Nginx | Docker | 80/443 | Reverse proxy with SSL |
| Elasticsearch | Docker | 9200 | Optional fallback search |

### CI/CD Pipeline

- **`develop` branch** → Auto-runs dev-checks on PR, auto-merges on success
- **`qa` branch** → Full test suite (lint, build, E2E, accessibility, Playwright)
- **`main` branch** → Production deploy, triggered by nightly release (2 AM UTC)
- **Deployment target:** PM2 on remote server at `162.251.161.17` (user `s903`)
- **Quality gates:** CC Guardrails (pre-commit), ESLint, TypeScript, Prettier, security audits
- **Protected files:** `.github/workflows/*`, `.husky/*`, `.eslintrc*`, `.prettierrc*`

---

## 2. Data Layer (Most Important)

### Database: PostgreSQL 15 with PostGIS

**Primary tables:**

| Table | Records | Purpose |
|-------|---------|---------|
| `imported_businesses` | 76.26M | Master store directory, partitioned by state |
| `chain_brands` | ~4,300 | Chain store brand summary (All The Places data, Wikidata-linked) |
| `chain_locations` | ~2.6M | Chain/franchise locations with OSM tags |
| `search_categories` | ~50 | Search category hierarchy with icons/colors |
| `products` | Millions | Product catalog per business |
| `deals` | Hundreds K | Store deals, coupons, promotions |

### Business Record Fields (`imported_businesses`)

```
Core:      id, name, category, category_sector, phone, website, email
Location:  address, city, state, zip, latitude, longitude, geometry (PostGIS)
Hours:     is_24_7, opens_at, closes_at, regular_hours
Status:    is_hiring, is_seeking_partner, is_for_sale, is_closing_soon
Offerings: has_deals, has_coupons, has_events, has_rewards, has_sharing_space
Counts:    deals_count, coupons_count, events_count, rewards_count
Metadata:  created_at, updated_at, import_run
```

### Data Sources

1. **All The Places** — 4,300+ chain brands + 20M+ global locations (Wikidata-linked)
2. **Government data** — Business registers, SBA lists
3. **Web scraping** — Custom infrastructure (Playwright, residential proxies, CAPTCHA solving)
4. **Business websites** — Direct imports
5. **Historical imports** — Yelp, Google Maps data (partially)

**Key fact:** Self-scraping infrastructure costs ~$5.5K/yr vs. $374K/yr for third-party APIs (documented in `DATA_ACQUISITION_INFRASTRUCTURE.md`).

### Search Infrastructure

| System | Role | Status |
|--------|------|--------|
| **Meilisearch** | Primary full-text search | ✅ 201GB index, facets, filters, sorting — live |
| **Elasticsearch** | Optional fallback / semantic | ⚠️ Configured, fallback-only |
| **PostgreSQL fulltext** | `tsvector` with English unaccent | ✅ Available |
| **PostGIS** | Geographic / distance queries | ✅ Spatial indexes in place |
| **pgvector** | Semantic embeddings | ❌ Planned, not deployed |

### ETL / Data Ingestion

- `/scripts/` — Data processing scripts
- `/apps/api/src/database/migrations/` — 9 numbered migrations (filters, NAICS codes, demographics, chains, products, categories)
- Mock data seeder: generates 100K–10M synthetic users for testing
- `data-import.controller.ts` — Admin-facing ETL pipeline management
- Incremental Meilisearch refresh strategy: planned but not automated

### Critical Indexes

- State / city / zip for location queries
- `category_sector` for NAICS filtering
- Boolean fields: `is_24_7`, `is_hiring`, `has_deals`
- PostGIS spatial indexes for distance queries
- Full-text search indexes on `name`, `category`, `description`

---

## 3. API Layer — Built vs. Missing

### Built Controllers (NestJS)

| Module | Controller | Endpoints | Status |
|--------|-----------|-----------|--------|
| Businesses | `businesses.controller.ts` | GET / (filtered), GET :id, POST, PATCH, DELETE, PATCH :id/hours | ✅ Core built |
| Search | `search.controller.ts` | Global search, categories, featured categories | ✅ Built |
| Meilisearch | `business-search.controller.ts` | Dedicated Meilisearch-backed search | ✅ Built |
| Auth | `auth.controller.ts` | Login, register, JWT | ✅ Built |
| Users | `users.controller.ts` | User CRUD, profiles | ✅ Built |
| Products | `products.controller.ts` | Product CRUD per business | ✅ Built |
| Deals | `deals.controller.ts` | Deal/coupon management | ✅ Built |
| Jobs | Mock jobs controller | Job posting + search | ⚠️ Mock data only |
| Chat | `chat.controller.ts` | Real-time messaging (Socket.io) | ✅ Built |
| Business Claims | `business-claims.controller.ts` | Ownership verification | ✅ Built (incomplete integration) |
| CMS | `cms.controller.ts` | Content management | ✅ Built |
| Files | `files.controller.ts` | File upload/storage | ✅ Built |
| Location | `location.controller.ts` | Zipcode lookup, geolocation | ✅ Built |
| Notifications | `notifications.controller.ts` | Real-time notifications | ✅ Built |
| Reviews | `reviews.controller.ts` | Review/rating system | ✅ Built |
| Events | `events.controller.ts` | Event management | ✅ Built |
| Data Import | `data-import.controller.ts` | ETL pipeline admin | ✅ Built |
| Metrics | `metrics.controller.ts` | Prometheus metrics | ✅ Built |
| API Status | `api-status.controller.ts` | Health checks + admin dashboard | ✅ Built |
| Landing | `landing.controller.ts` | Static marketing content | ✅ Built |

### Authentication

- ✅ JWT-based (passport-jwt) + Local strategy
- ✅ Firebase Admin for mobile push notifications
- ✅ Global `JwtAuthGuard` protecting routes
- ✅ `@CurrentUser()` decorator for extracting user from token

### Location Filtering

- ✅ `X-Zipcode` header (required globally)
- ✅ `X-Distance-Miles` header (optional, default 25 miles)
- ✅ `@LocationContext` decorator provides location object to controllers
- ✅ `@SkipLocationFilter()` for endpoints that opt out

### API Design Patterns

- Swagger/OpenAPI fully documented at `/docs`
- URI-based versioning: `/api/v1/...`
- Global validation pipe with class-validator & class-transformer
- Response compression (gzip)
- CORS: `localhost:3000`, `localhost:8081`, `*.vercel.app`
- Helmet security headers
- Global error handling via exception filters

### What's Missing / Incomplete

| Gap | Impact |
|----|--------|
| ❌ Admin panel (AdminJS disabled) | No moderation capability |
| ❌ Rate limiting / DDoS protection | Critical for public-facing scale |
| ❌ Response pagination on list endpoints | Unbounded queries risk memory exhaustion |
| ❌ Email notifications (not integrated) | No user lifecycle emails |
| ❌ Analytics (GA4, Sentry not deployed) | Blind to user behavior |
| ❌ Monetization layer (adSense, premium features) | No revenue path |
| ⚠️ Business claim integration | Controller exists, UI connection incomplete |
| ⚠️ Redis caching | Infrastructure ready, `SearchCacheService` not implemented |
| ⚠️ BullMQ job queues | Infrastructure ready, not wired for imports |
| ⚠️ Semantic search (pgvector) | Planned, not deployed |
| ⚠️ Multi-language support | Infrastructure present, not connected |

---

## 4. Frontend — Built vs. Missing

### Pages / Routes (Next.js 14.2)

| Route | Status | Purpose |
|-------|--------|---------|
| `/`, `/home-v2` | ✅ Built | Homepage with featured businesses |
| `/dashboard/*` | ✅ Built (30+ sub-routes) | Business owner + job seeker dashboard |
| `/auth/login`, `/register` | ✅ Built | Authentication flows |
| `/auth/reset-password`, `/verify-code` | ✅ Built | Password recovery |
| `/business/*` | ✅ Built | Public business profiles + editing |
| `/career/*`, `/job*` | ✅ Built | Job listings + applications |
| `/deals*` | ✅ Built | Deal/coupon browsing |
| `/articles/*` | ✅ Built | Blog content |
| `/search` | ✅ Built | Search results (partial filter UI) |
| `/help-center` | ✅ Built | FAQ/support |
| `/about-us`, `/contact-us`, `/founder` | ✅ Built | Static marketing pages |
| `/coming-soon` | ✅ Built | Teaser pages |
| Legal pages | ✅ Built | Privacy, CCPA, DMCA, cookie policy |

### UI Stack

- Material-UI v5.10 with custom theme + Emotion styling
- Mapbox GL for maps
- FullCalendar for appointments
- Redux + Redux Toolkit for state
- Framer Motion for animations
- i18next configured (not fully integrated)
- Firebase Auth for push notifications
- Mock data provider for backend-less testing

### Dashboard Sections

- `@dashboard/general` — Overview dashboard
- `@dashboard/business-profile` — Business management
- `@dashboard/job-seeker` — Job search & applications
- `@dashboard/deals` — Deal creation/management
- `@dashboard/chat` — Real-time messaging UI
- `@dashboard/calendar` — Appointment scheduling
- Store public pages — Consumer-facing business listing pages

### What's Missing / Incomplete

| Gap | Impact |
|----|--------|
| ❌ Mobile app | Web-only; no iOS/Android |
| ❌ Payment/checkout UI | Stripe not integrated |
| ❌ Seller onboarding flow | Business registration incomplete |
| ⚠️ Search filter UI | Facet filters disconnected from Meilisearch |
| ⚠️ Distance display in results | Headers work, UI display missing |
| ⚠️ Category-based browsing on homepage | API works, UI incomplete |
| ⚠️ Review/ratings UI | Backend exists, components incomplete |
| ⚠️ Real-time notification UI | Socket.io ready, UI not integrated |
| ⚠️ Multi-language UI | i18n configured, translations not populated |
| ⚠️ Analytics tracking | GA4 placeholder not connected |
| ⚠️ WCAG accessibility | A11y project exists, incomplete |

---

## 5. CLAUDE.md & Planning Docs

### Development Context (from CLAUDE.md)

- All dev happens on remote server: `162.251.161.17` SSH as `s903`
- Production code at `/home/s903/stolution/`
- Database: `ssh stolution "docker exec -it stolution-postgres psql..."`
- Pre-commit hooks: CC Guardrails (blocks `eslint-disable`, `@ts-ignore`, `TODO`, `console.log`), formatting, linting, types, secret scanning

### Master Strategic Roadmap

**P0 — Critical (build toward 1M visitors/day):**
1. Cloud Migration — 60% done (moving to Hetzner)
2. Search Enhancement — 40% done (Redis caching, semantic search, pgvector)
3. Database Optimization — 45% done (query perf, connection pooling, materialized views)
4. Cybersecurity & Compliance — 20% done (SOC2, HIPAA, GDPR)
5. SEO & Content Strategy — 25% done (sitemap, structured data)
6. Legal & Compliance — 40% done

**P1 — High:**
- Backend Architecture — 50% (BullMQ, WebSocket, event-driven)
- Frontend Architecture — 30% (component library, micro-frontends)
- Analytics & Business Intelligence — 15%
- Marketing & Promotion — 10%
- Customer Support — 5%

**P2 — Medium:**
- Monetization Strategy — 75% designed (freemium model planned)
- Mobile App — 0%
- Partnership & B2B — 30%
- Community Building — 10%

### Traffic Growth Targets

| Milestone | Daily Visitors | Monthly |
|-----------|---------------|---------|
| Month 1 | 1,000 | 30,000 |
| Month 6 | 100,000 | 3M |
| Month 12 | 1,000,000 | 30M |

### Key Architecture Docs in `/docs`

- `EVENT_DRIVEN_ARCHITECTURE.md` — Event sourcing, outbox pattern, TypeORM subscribers
- `ADVANCED_SEARCH_OPTIMIZATION.md` — Query caching, facet analysis, semantic search plan
- `DATABASE_ARCHITECTURE_ANALYSIS.md` — Schema analysis, partitioning strategy
- `MASTER_DATA_SOURCES_DIRECTORY.md` — All data sources (government, APIs, scraping)
- `DATA_ACQUISITION_INFRASTRUCTURE.md` — Self-scraping cost analysis ($5.5K/yr vs $374K API)
- `GO_LIVE_CLOUD_MIGRATION_PLAN.md` — Migration checklist & timeline
- `MASTER_CATALOGUE_ARCHITECTURE.md` — Product catalog unified schema

---

## 6. Gap Analysis

### What IS Working End-to-End

| Feature | Status | Notes |
|---------|--------|-------|
| Store directory search | ✅ | Meilisearch indexing + location filtering operational |
| Store detail pages | ✅ | Public business profiles visible |
| Business CRUD | ✅ | Owners can create/edit businesses |
| Authentication | ✅ | JWT + Firebase working |
| Deal management | ✅ | Deals/coupons created per business |
| Real-time chat infrastructure | ✅ | Socket.io ready |
| Job posting (mock) | ⚠️ | Mock data only |
| Admin/CMS | ⚠️ | AdminJS disabled, partially built |

### The Critical Gap: Consumer Discovery Flow is Broken

The platform has 76M+ store records but the **search → discovery → trust** pipeline is incomplete:

1. **Search filter UI** is disconnected from Meilisearch facets (backend works, frontend doesn't use it)
2. **Distance sorting** headers exist, but no distance display in search results
3. **Category browsing** on homepage is incomplete
4. **No business quality scoring** — 76M records with no way to rank "good" vs. "bad" listings
5. **Claim system** not connected — unverified vs. verified businesses are indistinguishable

### Single Most Impactful Thing to Build First

**🎯 Complete the Search + Discovery Pipeline**

This is the critical path because:
- 76M store records are useless without discoverable search
- SEO traffic (the primary growth driver for local search) depends on well-structured, discoverable content
- Business verification and quality signals are prerequisites for trust
- Everything downstream (monetization, premium placement, analytics) depends on users actually finding stores

### Dependency Order for Feature Development

```
TIER 0 — Foundational (build first)
  1. Complete Search UI
     ├─ Dynamic facet filters wired to Meilisearch
     ├─ Distance-based sorting + distance display in results
     ├─ Category landing pages (city + category combos for SEO)
     └─ Search analytics (log popular queries)

  2. Business Quality + Trust Signals
     ├─ Relevance scoring (claimed, reviews, recent activity)
     ├─ Business claim verification flow (UI connection)
     ├─ Review/rating aggregation display
     └─ Verified badge / unverified distinction

  3. Infrastructure Quick Wins
     ├─ Implement SearchCacheService (Redis) — ~73% faster search
     ├─ Add pagination to all list endpoints
     └─ Rate limiting / basic DDoS protection

TIER 1 — Revenue + Growth (next 2 months)
  4. SEO Optimization
     ├─ Canonical URLs for every business page
     ├─ Structured data (schema.org LocalBusiness)
     ├─ XML sitemap (76M+ pages, incremental)
     └─ Open Graph meta tags

  5. Admin Dashboard
     ├─ Business moderation queue
     ├─ Data quality monitoring
     └─ Manual ranking adjustments

  6. Monetization Layer
     ├─ Featured/sponsored listings
     ├─ Premium placement in search results
     └─ Business subscription tiers

TIER 2 — Scale + Intelligence (2–4 months)
  7. Analytics & Insights
     ├─ Google Analytics 4 integration
     ├─ Conversion tracking
     └─ Query analytics dashboard

  8. Personalization Engine
     ├─ Saved favorites, search history
     ├─ Recommendations (similar stores, trending nearby)
     └─ A/B testing framework

TIER 3 — Advanced (4–6 months)
  9. Semantic Search (pgvector)
     ├─ Business embedding generation
     └─ Hybrid keyword + semantic search

  10. Mobile App (iOS / Android)

  11. B2B / API Layer
      ├─ Public API for third-party integrations
      └─ White-label solution
```

### Infrastructure Readiness Assessment

| Component | State | Bottleneck |
|-----------|-------|-----------|
| Database | PostgreSQL 115GB, 76M rows, partitioned | ✅ Ready for scale |
| Search | Meilisearch 201GB index | ✅ Ready for scale |
| Caching | Redis configured | ⚠️ `SearchCacheService` not implemented |
| API pagination | NestJS endpoints | ❌ Unbounded queries — must fix |
| Job queues | BullMQ infrastructure ready | ⚠️ Not wired for data imports |
| Rate limiting | Not implemented | ❌ Must add before traffic scale |
| Real-time | Socket.io ready | ⚠️ Not integrated with business updates |
| Monitoring | Prometheus + Grafana configured | ⚠️ Not actively monitoring API |

### Quick Wins (Low Effort, High Impact)

1. **Implement `SearchCacheService` (Redis)** — ~73% faster search
2. **Add pagination to all list endpoints** — Prevents memory exhaustion at scale
3. **Complete business claim verification UI** — Builds user trust
4. **Add review aggregation display** — Social proof for store listings
5. **Create category + city landing pages** — SEO foundation for organic traffic

### What NOT to Build Yet

- Mobile app (Tier 3) — Web is sufficient; core search needs to work first
- Semantic search (Tier 3) — Good keyword search is fine; skip pgvector for now
- Community features — No user base yet; premature investment
- Advanced B2B features — Core consumer product must exist first

---

## Summary

**Stolution is a marketplace skeleton with excellent data and infrastructure but an incomplete consumer-facing product.**

The platform has:
- ✅ 76M+ store records in a well-structured, indexed database
- ✅ A 201GB Meilisearch index ready for full-text search
- ✅ 20+ NestJS API modules covering nearly every marketplace feature
- ✅ 30+ Next.js pages for the complete user journey

But the critical **search → discovery → trust** flow is not fully wired. Search facet filters are disconnected from the backend, distance sorting doesn't display in results, and there's no business quality/verification system to differentiate legitimate stores from stale records.

**To make Stolution immediately useful:** wire up the search UI filters, build the category/city landing pages, implement business verification, add review aggregation, and add Redis caching. These 5 items — combined with 76M+ existing store records — would create a functional, searchable neighborhood commerce directory capable of driving early SEO traffic and hitting Month 1 goals.

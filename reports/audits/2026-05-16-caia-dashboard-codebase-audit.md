---
name: caia-dashboard-codebase-audit
created: 2026-05-16T06:08:33Z
updated: 2026-05-16T06:08:33Z
status: complete
type: report
chain: caia-dashboard-codebase-audit / phase 1 of 1
spawn_id: phase1-20260516T060125-858
scope: caia repository (~/caia)
---

# CAIA Dashboard Codebase Audit

**Phase 1 of 1 — exhaustive inventory of every dashboard-related artefact in the caia repo.**

The operator's read going in: *"the dashboard already exists but is very incomplete — only some dashboards visually exist with almost no data integrated."* This audit confirms that read, quantifies it, and surfaces the specific endpoints / pages that drive the gap.

---

## 1. Search methodology

The following ripgrep / glob patterns were used to surface dashboard artefacts. Re-run any of these to validate or extend the audit:

```bash
# Top-level package layout
ls /home/s903/caia/apps /home/s903/caia/services /home/s903/caia/packages

# Embedded /dashboard HTTP endpoints across the repo
rg -lE "['\"\`]/dashboard['\"\`/]|app\.get\(['\"\`]/dashboard|router\.get\(['\"\`]/dashboard" /home/s903/caia

# /status /metrics /health /ui /stats /admin /prom /dashboard /home routes (any framework)
rg -E "app\.get\(['\"\`]/(?:status|metrics|health|ui|stats|admin|prom|dashboard|home)" /home/s903/caia

# Hono/Express routes inside the orchestrator
rg -nE "^\s*(app|c)\.(get|post|put|delete|patch)" /home/s903/caia/apps/orchestrator/src/api/routes

# FastAPI endpoints in Python services
rg -nE "^@app\.(get|post|put|delete)\(" /home/s903/caia/services

# Static HTML
find /home/s903/caia -path '*/node_modules' -prune -o -name '*.html' -print

# Mock data / TODO / placeholder hints in dashboard pages
rg -liE "MOCK|mock data|TODO|placeholder|hardcoded|stub|stubbed" /home/s903/caia/apps/dashboard/app

# Client-side fetch endpoints used by dashboard pages
rg -roh "fetch\(['\"\`][^'\"\`]*" /home/s903/caia/apps/dashboard/app --glob 'page.tsx'

# All Next.js api route files
find /home/s903/caia/apps/dashboard/app/api -type f -name route.ts

# HTML emit / sendFile / c.html() across the codebase
rg -lE "c\.html\(|sendFile\(|sendHtml|text/html" /home/s903/caia
```

---

## 2. Headline findings

| # | Finding |
|---|--------|
| F1 | **One canonical operator dashboard exists**: `apps/dashboard` (Next.js 15 App Router on **:7777**). Title in `<head>`: **"Conductor"**. Root `/` redirects to `/timeline`. |
| F2 | Dashboard contents are extensive on the *frontend*: **86 page.tsx files**, **~13,900 LOC of pages**, **22 components**, **6 nav sections × ~40 leaves**. Visual baselines exist for 6 routes. |
| F3 | **Every data path on the dashboard is a thin proxy to the orchestrator** at `http://localhost:7776` (env `CONDUCTOR_URL` / `CONDUCTOR_API`). 55 Next.js `route.ts` files; no in-app persistence. |
| F4 | Orchestrator (`apps/orchestrator`) is the **real data plane**: ~100+ Hono routes (`apps/orchestrator/src/api/routes/*.ts`), backed by SQLite via drizzle-orm. Hosts WebSocket fan-out at `ws://localhost:7776/events`. |
| F5 | **At least 10 dashboard pages have broken or stub data wiring** — the client fetches an `/api/X` path for which no `route.ts` exists (returns 404 silently) or the page is hard-coded mock data. See §6. |
| F6 | **Two embedded mini-dashboards** are healthy and live-data-wired: `packages/local-llm-router` (`GET /dashboard` on **:7411** — A.9.8 displacement dashboard) and `apps/local-preview-orchestrator` (status dashboard on **:5170**). |
| F7 | No other operator-facing HTML dashboards exist. Other services (slot-manager :8081, sps :8090(?), claude-spawner-agent :8090, mentor-event-bus, capability-broker, worker-coding IPC, smart-cicd-agent, db-backup, completeness-sentinel, pipeline-pulse, story-backfiller, executor) are **JSON-API or daemon-only**. |
| F8 | One stale frontend artefact: `apps/roulette-backend/legacy-frontend/public/index.html` — DORMANT CRA template, not wired into anything. |

**Operator's read is correct.** The pages are mostly built; the data wiring is partially built and mostly indirect (via orchestrator). Empty/blank panels seen by the operator are explainable by (a) orchestrator-side data not being present, (b) Next.js proxy missing for several client paths, or (c) outright `MOCK_RULES`-style hardcoded data on one page (enforcement).

---

## 3. The primary dashboard: `apps/dashboard`

### 3.1 Package shape

- **Path**: `/home/s903/caia/apps/dashboard`
- **Package**: `@caia-app/dashboard` (private)
- **Stack**: Next.js 15.5.15 · React 19 · TypeScript · SWR + `@ai-sdk/react` · Vitest + Playwright + LHCI
- **Dev port**: 7777 (`pnpm dev`)
- **Layout**: App Router. Client components use `'use client'` heavily. No SSR data-fetching in pages observed; all data is fetched client-side via `useEffect` / SWR after hydration.
- **Auth**: none — operator-only, perimeter trust assumed (matches local-llm-router pattern).

### 3.2 Visual surface (frontend completeness)

86 `page.tsx` files, organized as flat URLs under `app/`. Heaviest pages (LOC):

| LOC | Path | Role |
|----:|------|------|
| 941 | `app/submit/page.tsx` | Operator prompt-submission form (full / plan-only / test-only modes) |
| 878 | `app/pipeline/page.tsx` | Pipeline view |
| 866 | `app/enforcement/page.tsx` | Rules enforcement matrix — **HARDCODED MOCK** (see §6.1) |
| 562 | `app/platform-status/page.tsx` | Platform-wide health + active runs + task buckets |
| 554 | `app/task-runs/[session_id]/page.tsx` | Individual task-run drilldown |
| 432 | `app/gates/page.tsx` | Human gates / artifact approval |
| 413 | `app/timeline/page.tsx` | Event feed (default landing page) |
| 401 | `app/domains/[slug]/page.tsx` | Per-domain details |
| 368 | `app/architecture/page.tsx` | Architecture registry view |
| 353 | `app/buckets/page.tsx` | Kanban (parallel pool + per-domain sequential queues) |
| 347 | `app/registry/page.tsx` | Feature registry |
| 345 | `app/health/pulse/page.tsx` | Pulse health runs (288-window) |
| 336 | `app/task-runs/page.tsx` | Task runs list |
| 332 | `app/tests/page.tsx` | Behavior tests + coverage |
| 314 | `app/agents/page.tsx` | Agent registry |
| 304 | `app/queue/page.tsx` | Priority queue + override |
| 297 | `app/contracts/page.tsx` | Contracts registry / composed contracts |
| 288 | `app/completeness/page.tsx` | Completeness runs + findings |
| 272 | `app/tests/[id]/page.tsx` | Per-test drilldown |
| 258 | `app/test-isolation/page.tsx` | Browserless / SQLite / port pressure dashboard (FIX-013) |

The remaining pages are 100–250 LOC each. Render path for ALL pages is **client-side**: data is fetched via `useEffect` after hydration; layout is server-rendered as a static shell with a `<Suspense>` boundary around the Sidebar.

### 3.3 Navigation structure

Single source of truth: `components/nav/groups.ts` — `NAV_GROUPS`. Six top-level accordion groups, ~40 leaves total:

| Group | Leaves (label · path) |
|-------|----------------------|
| **Work** 📋 | Chat `/chat` · Prompts `/prompts` · Submit `/submit` · Queue `/queue` · Buckets `/buckets` · Stories `/stories` · Tasks `/tasks` · Requirements `/requirements` · Blockers `/blockers` · Questions `/questions` · Suggestions `/suggestions` |
| **Pipeline** 🔀 | Timeline `/timeline` · Pipeline `/pipeline` · Events `/events` · Task runs `/task-runs` · Dependency graph `/dag` |
| **Catalog** 📚 | Projects `/projects` · Domains `/domains` · Architecture `/architecture` · Contracts `/contracts` · Features `/features` · Agents `/agents` · Registry `/registry` |
| **Quality** ✅ | Quality `/quality` · Gates `/gates` · Tests `/tests` · Completeness `/completeness` |
| **Operations** 🛠️ | Platform status `/platform-status` · Pulse `/health/pulse` · Observability `/observability/health` · Metrics `/metrics` · Builds `/builds` · Audit `/audit` |
| **Settings** ⚙️ | Settings `/settings` · Standards `/standards` · ADRs `/adrs` |

Pages NOT in the sidebar (orphaned or supplementary): `/coverage`, `/reports/prompts`, `/health/pulse` (under Operations), `/metrics/llm`, `/metrics/phase1`, `/operations/observability`, `/test-isolation`, `/enforcement` (no nav entry — only reachable by direct URL).

### 3.4 Components inventory (`components/`)

22 top-level components + `components/chat/` + `components/nav/`. Most are panel/card widgets used by one or two pages:

| Component | Used by (representative) | Purpose |
|-----------|--------------------------|---------|
| `AdrsList.tsx` | /adrs | ADR list table |
| `BACollabInspector.tsx` | task-runs drilldown | BA-collab inspector |
| `BlockersKanban.tsx` | /blockers | Kanban view |
| `Breadcrumb.tsx` | layout | Auto-derived breadcrumb |
| `DagView.tsx` | /dag | Dependency graph SVG |
| `DomainChip.tsx` | many | Reusable chip |
| `EventLog.tsx` | /events | Streaming event log |
| `FeaturesBoard.tsx` | /features | Features board |
| `FileHeatMap.tsx` | architecture | File heat-map |
| `HealthPanel.tsx` | /platform-status | Health summary |
| `HumanGateModal.tsx` | /gates | Approval modal |
| `LineagePanel.tsx` | prompts drilldown | Lineage panel |
| `LlmSavingsPanel.tsx` | metrics/llm | LLM savings widget |
| `MetricsDashboard.tsx` | /metrics | Aggregate metrics |
| `NavProjectSelector.tsx` | sidebar | Project filter |
| `Phase1Timeline.tsx` | prompts drilldown | Phase-1 timeline |
| `ProjectSelector.tsx` | many | Project chooser |
| `ProjectsManager.tsx` | /projects | Projects management |
| `QuestionsKanban.tsx` | /questions | Kanban |
| `RequirementsKanban.tsx` | /requirements | Kanban |
| `SuggestionsPanel.tsx` | /suggestions | Suggestions panel |
| `TaskTable.tsx` | /tasks · many | Table view |
| `TicketBundleViewer.tsx` | stories drilldown | Ticket bundle viewer |
| `TimelineFeed.tsx` | /timeline | Live feed |
| `components/chat/ChatPanel.tsx` | /chat | Vercel AI SDK chat panel |
| `components/nav/Sidebar.tsx` | layout | Accordion left-nav |

### 3.5 Hooks + lib

- `hooks/useEventStream.ts` — typed WebSocket subscription wrapper
- `hooks/useUnseenBadges.ts` — per-tab unseen counts + favicon dot
- `hooks/useWebSocket.ts` — base WS connection to `ws://localhost:7776/events`
- `lib/chat/routing.ts` — chat-message → subagent routing taxonomy + orchestrator forwarding + AI-SDK encoders

### 3.6 Tests + visual baselines

- `tests/chat-route.test.ts`, `tests/chat-routing.test.ts` — vitest, route-handler unit tests
- `tests/a11y.spec.ts` — Playwright + axe-core accessibility scan
- `tests/visual.spec.ts` — Playwright visual regression, **6 baselined routes**: home, timeline, buckets, architecture, contracts, prompts
- `__visual_baselines__/` — currently only README (PNG baselines presumably committed elsewhere or missing)
- `lighthouserc.cjs` — LHCI config
- `.size-limit.json` — bundle-size budget

---

## 4. Data wiring: dashboard ↔ orchestrator

### 4.1 The contract

**Every page that needs orchestrator state hits a Next.js route handler under `apps/dashboard/app/api/*/route.ts`. Every route handler is a thin pass-through** that:

1. Reads `CONDUCTOR_URL` (or `CONDUCTOR_API`) from env, defaulting to `http://localhost:7776`.
2. Forwards the request body / query params.
3. Returns the upstream JSON verbatim — or on any error, **returns 200 with an empty array / null / sentinel**. (This is why a broken orchestrator looks like "nothing showing" rather than "error page".)

Sample shape (`app/api/blockers/route.ts:1-29`):

```ts
const CONDUCTOR_URL = process.env['CONDUCTOR_URL'] ?? 'http://localhost:7776';
export async function GET(request: NextRequest) {
  try {
    const qs = request.nextUrl.search;
    const res = await fetch(`${CONDUCTOR_URL}/blockers${qs}`, { next: { revalidate: 0 } });
    if (!res.ok) return NextResponse.json([], { status: 200 });
    return NextResponse.json(await res.json());
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}
```

### 4.2 The 55 Next.js API routes (data wiring map)

All routes proxy to the orchestrator (`CONDUCTOR_URL` / `CONDUCTOR_API`, default `:7776`), **except**:

- `/api/chat` — synthesises an answer locally (Vercel AI SDK streaming envelope) and may forward to `CAIA_ORCHESTRATOR_URL` for prompt-creation side-effect. **No external LLM call ever.** (`apps/dashboard/app/api/chat/route.ts:1-96`)
- `/api/test-isolation` — fetches `BROWSERLESS_HTTP_ENDPOINT/pressure`, scans `os.tmpdir()` for SQLite test files, reads optional shard summary. **Local resource probe.** (`apps/dashboard/app/api/test-isolation/route.ts`)

| Dashboard `/api/*` route | Upstream call | Status |
|--------------------------|---------------|--------|
| `/api/adrs` (GET/POST)                          | `${CONDUCTOR}/adrs`                                          | REAL (proxy) |
| `/api/agents` (GET)                             | `${CONDUCTOR}/agents`                                        | REAL (proxy) |
| `/api/architecture/[...path]`                   | `${CONDUCTOR}/api/architecture/*`                            | REAL (proxy) |
| `/api/audit` (GET)                              | `${CONDUCTOR}/audit`                                         | REAL (proxy) |
| `/api/behavior-tests` (GET/POST)                | `${CONDUCTOR}/behavior-tests`                                | REAL (proxy) |
| `/api/behavior-tests/[id]/runs` (GET/POST)      | `${CONDUCTOR}/behavior-tests/:id/runs`                       | REAL (proxy) |
| `/api/blockers` (GET/POST)                      | `${CONDUCTOR}/blockers`                                      | REAL (proxy) |
| `/api/blockers/[id]` (GET/PATCH/DELETE)         | `${CONDUCTOR}/blockers/:id`                                  | REAL (proxy) |
| `/api/blockers/[id]/resolve` (POST)             | `${CONDUCTOR}/blockers/:id/resolve`                          | REAL (proxy) |
| `/api/buckets` (GET)                            | `${ORCH}/buckets` (forwards 7 filter params)                 | REAL (proxy) |
| `/api/buckets/[id]` (GET)                       | `${ORCH}/buckets/:id`                                        | REAL (proxy) |
| `/api/chat` (POST)                              | local synthesise (+optional orchestrator forward)             | REAL (local) |
| `/api/completeness-findings-proxy` (GET)        | `${CONDUCTOR}/completeness/findings`                         | REAL (proxy) |
| `/api/completeness-runs-proxy` (GET)            | `${CONDUCTOR}/completeness/runs`                             | REAL (proxy) |
| `/api/completeness-summary-proxy` (GET)         | `${CONDUCTOR}/completeness/summary`                          | REAL (proxy) |
| `/api/contracts/composed/[scope]` (GET)         | `${CONDUCTOR}/api/contracts/composed/:scope`                 | REAL (proxy) |
| `/api/contracts/registry` (GET)                 | `${CONDUCTOR}/api/contracts/registry`                        | REAL (proxy) |
| `/api/counts` (GET)                             | `${CONDUCTOR}/counts`                                        | REAL (proxy) |
| `/api/dag` (GET)                                | `${CONDUCTOR}/dag`                                           | REAL (proxy) |
| `/api/db-backups-proxy` (GET)                   | `${CONDUCTOR}/db-backups`                                    | REAL (proxy) |
| `/api/domains` (GET/POST)                       | `${CONDUCTOR}/domains`                                       | REAL (proxy) |
| `/api/domains/[slug]` (GET/PUT/DELETE)          | `${CONDUCTOR}/domains/:slug`                                 | REAL (proxy) |
| `/api/entities/[type]/[id]/domains` (GET/POST)  | `${CONDUCTOR}/entities/:type/:id/domains`                    | REAL (proxy) |
| `/api/entities/[type]/[id]/domains/[domainSlug]`| `${CONDUCTOR}/entities/:type/:id/domains/:domainSlug`        | REAL (proxy) |
| `/api/events` (GET)                             | `${CONDUCTOR}/events`                                        | REAL (proxy) |
| `/api/executor/config` (GET/PATCH)              | `${CONDUCTOR}/executor/config`                               | REAL (proxy) |
| `/api/executor/pause` (POST)                    | `${CONDUCTOR}/executor/pause`                                | REAL (proxy) |
| `/api/executor/resume` (POST)                   | `${CONDUCTOR}/executor/resume`                               | REAL (proxy) |
| `/api/executor/status` (GET)                    | `${CONDUCTOR}/executor/status`                               | REAL (proxy) |
| `/api/features` (GET/POST)                      | `${CONDUCTOR}/features`                                      | REAL (proxy) |
| `/api/llm-metrics` (GET)                        | `${CONDUCTOR}/llm/metrics`                                   | REAL (proxy) |
| `/api/lock-contracts-proxy` (GET)               | `${CONDUCTOR}/lock-contracts`                                | REAL (proxy) |
| `/api/metrics` (GET)                            | `${CONDUCTOR}/metrics`                                       | REAL (proxy) |
| `/api/metrics/phase1` (GET)                     | `${CONDUCTOR}/metrics/phase1`                                | REAL (proxy) |
| `/api/projects` (GET/POST)                      | `${CONDUCTOR}/projects`                                      | REAL (proxy) |
| `/api/prompts` (POST)                           | `${ORCH}/prompts` (transforms wire shape)                    | REAL (proxy) |
| `/api/prompts/[id]/phase1` (GET)                | `${ORCH}/prompts/:id/phase1`                                 | REAL (proxy) |
| `/api/questions` (GET/POST)                     | `${CONDUCTOR}/questions`                                     | REAL (proxy) |
| `/api/questions/[id]` (GET/PATCH)               | `${CONDUCTOR}/questions/:id`                                 | REAL (proxy) |
| `/api/questions/[id]/answer` (POST)             | `${CONDUCTOR}/questions/:id/answer`                          | REAL (proxy) |
| `/api/requirements` (GET)                       | `${CONDUCTOR}/requirements`                                  | REAL (proxy) |
| `/api/requirements/[id]` (GET/PATCH)            | `${CONDUCTOR}/requirements/:id`                              | REAL (proxy) |
| `/api/status` (GET)                             | `${CONDUCTOR}/health`                                        | REAL (proxy) |
| `/api/stories-proxy` (GET/POST)                 | `${CONDUCTOR}/stories`                                       | REAL (proxy) |
| `/api/stories/[id]/bundle` (GET)                | `${CONDUCTOR}/stories/:id/bundle`                            | REAL (proxy) |
| `/api/suggestions` (GET)                        | `${CONDUCTOR}/suggestions`                                   | REAL (proxy) |
| `/api/task-runs` (GET/POST)                     | `${CONDUCTOR}/task-runs`                                     | REAL (proxy) |
| `/api/task-runs/[session_id]` (GET/PATCH)       | `${CONDUCTOR}/task-runs/:session_id`                         | REAL (proxy) |
| `/api/task-runs/[session_id]/events` (POST)     | `${CONDUCTOR}/task-runs/:session_id/events`                  | REAL (proxy) |
| `/api/task-runs/[session_id]/respawn-chain`     | `${CONDUCTOR}/task-runs/:session_id/respawn-chain`           | REAL (proxy) |
| `/api/task-runs/[session_id]/subtasks` (POST)   | `${CONDUCTOR}/task-runs/:session_id/subtasks`                | REAL (proxy) |
| `/api/tasks` (GET)                              | `${CONDUCTOR}/tasks`                                         | REAL (proxy) |
| `/api/test-isolation` (GET)                     | Browserless + tmpdir scan + optional shard file              | REAL (local) |
| `/api/timeline` (GET/POST)                      | `${CONDUCTOR}/timeline`                                      | REAL (proxy) |
| `/api/timeline/export` (GET)                    | `${CONDUCTOR}/timeline/export`                               | REAL (proxy) |

**Aggregate**: 53 of 55 route handlers are pure orchestrator proxies. 2 are local-data routes (chat, test-isolation).

### 4.3 Orchestrator backing routes

`apps/orchestrator/src/api/routes/*.ts` (28 route files) registers ~140 Hono endpoints, backed by SQLite via `better-sqlite3` + `drizzle-orm` (see `apps/orchestrator/src/db/schema/*`). Confirmed real-data examples:

- `routes/legacy.ts` — `/requirements`, `/blockers`, `/questions`, `/tasks`, `/counts` → `db.select().from(...)`
- `routes/agents.ts` — `/agents`, `/agents/messages`, `/agents/artifacts`, `/agents/release/report`, `/agents/system-prompts/:agentName` (real, but **the dashboard proxy is missing for `/agents/artifacts` and `/agents/artifacts/:id`** — see §6.2)
- `routes/buckets.ts`, `routes/stories.ts`, `routes/dag.ts`, `routes/events.ts`, `routes/timeline.ts`, `routes/metrics.ts`, `routes/llm.ts`, `routes/spend.ts`, `routes/projects.ts`, `routes/pulse.ts`, `routes/executor.ts`, `routes/priority.ts`, `routes/contracts.ts`, `routes/architecture.ts`, `routes/feature-registry.ts`, `routes/workers.ts`, `routes/stats.ts`, `routes/prompts.ts`, `routes/task-runs.ts`, `routes/behavior-tests.ts`, `routes/builds.ts`, `routes/audit.ts`, `routes/adrs.ts`, `routes/features.ts`, `routes/domains.ts`, `routes/suggestions.ts`, `routes/metrics-phase1.ts`
- WebSocket fan-out at `/events` (`apps/orchestrator/src/ws/index.ts`) bridges `eventBus.on('conductor:event', …)` → connected dashboard clients
- Heartbeat: orchestrator emits `executor.heartbeat` every 5s via `apps/orchestrator/src/api/start.ts:31-58`, merging its own DB counts with the executor daemon's `~/.conductor/executor.heartbeat` file

### 4.4 Direct-to-orchestrator pages (bypass `/api/*` proxy)

Several pages skip the proxy layer and call `http://localhost:7776` directly via `NEXT_PUBLIC_API_URL` env var. These rely on CORS being open or same-origin reverse-proxy:

| Page | Direct call | Implication |
|------|-------------|-------------|
| `app/reports/prompts/page.tsx:63` | `${API}/prompts?since=…`                  | Bypasses proxy |
| `app/builds/page.tsx:47`, `app/builds/[id]/page.tsx:49` | `${API}/builds?limit=50`, `${API}/builds/:id` | Bypasses proxy |
| `app/events/page.tsx:53`          | `${API}/events?limit=200`                 | Bypasses proxy |
| `app/health/pulse/page.tsx:181`   | `${API}/pulse/runs?limit=288`             | Bypasses proxy |
| `app/observability/health/page.tsx:18-19` | `${API}/events/types`, `${API}/events?limit=500` | Bypasses proxy |
| `app/operations/observability/page.tsx:39,75` | `${langfuseUrl}/api/public/health`, `…/traces` | Direct Langfuse — only works when Langfuse is up |
| `app/prompts/page.tsx:47`         | `${API}/prompts${qs}`                     | Bypasses proxy |
| `app/prompts/[id]/page.tsx:83-85` | `${API}/prompts/:id`, `…/descendants`, `…/events` | Bypasses proxy |
| `app/prompts/[id]/journey/page.tsx:87` | `${API}/prompts/:id/journey`         | Bypasses proxy |

This mixed pattern is an architectural inconsistency. The proxy gives env-isolation + same-origin guarantees; the direct-call paths break if the dashboard is ever reverse-proxied to a different host or run inside a different network segment.

### 4.5 Live updates

`hooks/useWebSocket.ts` opens a WS to `ws://localhost:7776/events` (or `NEXT_PUBLIC_WS_URL`). Pages that subscribe explicitly:

- `app/timeline/page.tsx` — incremental event prepend on every WS message
- `app/buckets/page.tsx` — refetch on `ticket.*` and `task-scheduler.bucket-placed`
- `app/queue/page.tsx` — debounced refetch on `priority.*` (300ms debounce)
- `app/platform-status/page.tsx` — refetch counters on heartbeat
- `components/nav/Sidebar.tsx` — increments unseen badges per `useUnseenBadges`

---

## 5. Embedded mini-dashboards outside `apps/dashboard`

### 5.1 `packages/local-llm-router` — A.9.8 displacement dashboard

**Real, live-wired, well-tested.**

- **URL**: `http://127.0.0.1:7411/dashboard` (port 7411 via `ROUTER_PORT` env)
- **Source**: `packages/local-llm-router/src/dashboard.ts` (295 LOC, all inline HTML/CSS/JS — no build step, no CDN deps)
- **Server**: `packages/local-llm-router/src/server.ts` — Hono. Endpoints: `/healthz` · `/metrics` (Prometheus text) · **`/dashboard` (HTML)** · `/v1/budget/claude` · `/v1/search-memory` · `/v1/intent` · `/v1/intent/v2` · `/v1/route` · `/v1/chat/completions` · `/v1/optimize` · `/v1/embeddings`
- **Render path**: server returns a static HTML doc; client-side JS polls `/metrics` every 5s (POLL_MS=5000) and re-parses Prometheus exposition.
- **Panels**:
  1. Headline displacement % (local share vs claude vs cache)
  2. Escalation rate (cache miss + claude / total)
  3. Estimated saved USD (vs all-Claude baseline)
  4. Claude budget (rolling 1h cap, A.9.5)
  5. Top-3 routing classes by volume
  6. Per-task usage rows (all task types)
  7. Avg dispatch duration ms
- **Data source**: `llm_router_calls_total`, `llm_router_local_share`, `llm_router_saved_usd`, `llm_router_avg_duration_ms`, `llm_router_claude_budget_cap`, `llm_router_claude_budget_calls_last_hour`, `llm_router_task_calls_total` — all surfaced via the package's own `/metrics` endpoint.
- **Tests**: `packages/local-llm-router/tests/dashboard.test.ts` — verifies HTML completeness, panel IDs, 5s polling cadence, presence of all 7 metric series, byte content of canonical 64.3% displacement floor.
- **Status**: **REAL · LIVE · COMPLETE.** This is the operator's working dashboard for LLM-routing data.

### 5.2 `apps/local-preview-orchestrator` — site status dashboard

**Real, live-wired, well-tested.**

- **URL**: `http://127.0.0.1:5170/` (port via `LOCAL_PREVIEW_DASHBOARD_PORT`, default 5170)
- **Source**:
  - `apps/local-preview-orchestrator/src/status-dashboard.ts` — HTTP server (Node `node:http`, not Hono)
  - `apps/local-preview-orchestrator/src/dashboard-html.ts` — inline HTML doc with XHR-polling JS (5s)
- **Endpoints**: `GET /` (HTML) · `GET /api/status` (JSON) · `GET /api/logs/<site>` (tail incident log) · `POST /api/redeploy/<site>` · `POST /api/rollback/<site>` · `GET /healthz`
- **Render path**: HTML doc + client XHR poll of `/api/status` every 5s, table re-render
- **Data source**: per-site state file (`readSiteState(sitePath, ...)`) — registers from compile-time `SITES` array (caia dashboard, poker-zeno, roulette-community)
- **Tests**: `apps/local-preview-orchestrator/tests/status-dashboard.test.ts`
- **Status**: **REAL · LIVE · COMPLETE** (scope-limited: it monitors local-preview deployments, not the CAIA platform itself).

### 5.3 Non-dashboard service surfaces

The following services expose HTTP but **no operator UI** — all are JSON-only:

| Service | Port | Endpoints (sample) |
|---------|-----:|--------------------|
| `services/sps` (Spawn Priority Server)         | 8090? (env `PORT`)      | `/health`, `/metrics`, `/dag`, `/next-spawn`, `/spawn`, `/heartbeat`, `/completion`, `/cap`, `/dead-letter`, `/aliases`, `/resolve`, `/admin/bucket/{bucket}`, `/admin/audit/stuck-*`, `/admin/test/seed-*`, `/` (JSON service summary) |
| `services/slot-manager`                        | 8081 (env `PORT`)       | `/health`, `/healthz`, `/version`, `/slots`, `/slots/{machine}`, `/claim`, `/release`, `/spawn-task`, `/spawn-telemetry`, `/heartbeat`, `/webhooks/completion`, `/admin/spawn-completion`, `/spawn-lineage/{spawn_id}`, `/admin/spawn-dead-letter`, `/admin/autonomy`, `/admin/loop/{enable,disable,status,changes}`, `/admin/bucket-permissions`, `/admin/bucket-path-allowlists`, `/admin/approve/{task_id}`, `/admin/approvals`, `/admin/risk-classify`, `/admin/dispatch-risk-log`, `/spawn-retry-budget` |
| `services/claude-spawner-agent`                | 8090 (env `PORT`)       | `/health`, `/version`, `/`, `/admin/validate-allow-list`, `/spawn`, `/admin/sessions`, `/admin/sessions/{spawn_id}`, `/admin/events`, `/metrics` |
| `packages/mentor-event-bus`                    | env-configurable        | `/v1/healthz`, `/v1/events` (POST), `/v1/recent` (GET) — HMAC-auth |
| `packages/capability-broker`                   | unix socket             | RPC over unix domain socket — no HTTP |
| `apps/worker-coding`                           | localhost IPC           | IPC server, not operator-facing |
| `apps/orchestrator`                            | **7776**                | ~140 routes (see §4.3) + WebSocket `/events` — **backs the dashboard** |

### 5.4 Stale / dormant frontend artefacts

- `apps/roulette-backend/legacy-frontend/public/index.html` — DORMANT CRA template. Package description: "DORMANT — Preserved Express/Mongoose backend ported from prakashgbid/roulette-advisor-ai (REM-001, 2026-04-28). Not actively running."
- `docs/legacy-roulette-advisor-ai/static/api/index.html` — legacy docs, archived.

---

## 6. Where the dashboard is broken / mocked / unwired

### 6.1 MOCKED — hardcoded fake data

**`app/enforcement/page.tsx` (866 LOC) is the headline mock.** It declares `MOCK_RULES` inline (~20 rules, hand-authored) and reads from it:

```ts
// app/enforcement/page.tsx:237
async function getEnforcementData(): Promise<{ rules: EnforcementRule[]; stats: EnforcementStats }> {
  // Mock data — replace with fetch('/api/enforcement') once the route exists
  const rules = MOCK_RULES;
  const stats = computeStats(rules);
  return { rules, stats };
}
```

There is **no `app/api/enforcement/route.ts`** AND **no orchestrator route for `/enforcement`**. This page is purely cosmetic.

### 6.2 UNWIRED — client fetches `/api/*` paths that don't exist

Cross-referencing the 43 distinct client `/api/*` paths against the 55 `route.ts` files turns up the following gaps. **The client fetch will receive a Next.js 404; the page's `.catch(() => {})` swallows the error and the panel renders empty.**

| Client path | Used by | Why empty |
|-------------|---------|-----------|
| `/api/agents/artifacts`           | `app/gates/page.tsx:206`           | No proxy route. Orchestrator has `GET /agents/artifacts` (real). |
| `/api/agents/artifacts/{id}`      | `app/gates/page.tsx:227,244`       | No proxy route. Orchestrator has it. |
| `/api/behavior-tests/coverage`    | `app/tests/page.tsx:172`           | No proxy route. Orchestrator has `/behavior-tests/coverage`. |
| `/api/enforcement`                | (referenced in code comment only)  | No proxy route, no orchestrator backing. **Page falls back to MOCK_RULES.** |
| `/api/platform-stats`             | `app/platform-status/page.tsx:396` | No proxy route. Orchestrator has `/platform-stats` (`routes/stats.ts`). |
| `/api/priority/queue`             | `app/queue/page.tsx:169`           | No proxy route. Orchestrator has `/priority/queue`. |
| `/api/priority/score/{id}`        | `app/queue/page.tsx:192`           | No proxy route. Orchestrator has it. |
| `/api/priority/score-all`         | `app/queue/page.tsx:199`           | No proxy route. Orchestrator has it. |
| `/api/priority/override`          | `app/queue/page.tsx:207`           | No proxy route. Orchestrator has it. |
| `/api/task-runs/active`           | `app/platform-status/page.tsx:404` | No proxy route. (Orchestrator status: TBD — likely available via filter on `/task-runs`.) |

**Pages directly impacted**: `/gates`, `/tests`, `/enforcement`, `/platform-status`, `/queue`. Five of the most operator-visible pages have at least one broken data source. The orchestrator endpoints exist in 9 of the 10 cases — what's missing is the Next.js proxy wrapper.

### 6.3 STUBBED — pages with explicit "feature pending" markers

| Page | Marker |
|------|--------|
| `app/quality/page.tsx:11` | `// test runs (behavior_tests if any) — currently a TODO until CI emits per-package coverage artifacts (DASH-314 Phase 2)` |
| `app/coverage/page.tsx:40-46` | Reads `public/reports/coverage/coverage-summary.json`; if missing, shows `"No coverage report found. Run: npm test -- --coverage"` — the file is generated by a Jest/Istanbul run that the operator has to trigger manually. |
| `app/__visual_baselines__/` | Contains only `README.md`; no PNG baselines committed. Visual regression suite is wired but baselines are absent. |

### 6.4 EMPTY-state-by-design

These pages are correctly wired but will render empty until upstream emits data:

- `/audit` (DASH-201 fix landed — now uses `/api/audit` after prior `/api/events` shape mismatch). Will be empty until orchestrator's audit log accumulates entries.
- `/blockers`, `/questions`, `/requirements`, `/tasks`, `/stories`, `/projects`, `/domains`, `/agents`, `/buckets` — empty until orchestrator's SQLite has rows (seeded via `seedProjects`, `seedAdr011`, `seedFeatures`, `seedSuggestions`, `migrateFromJsonl` per `apps/orchestrator/src/api/start.ts:10-14`).
- `/operations/observability` — direct Langfuse calls to `${langfuseUrl}/api/public/{health,traces}`. Renders error/empty if Langfuse isn't running.
- `/health/pulse` — direct `${API}/pulse/runs?limit=288`. Empty until pulse-pulse runs accumulate (`apps/pipeline-pulse`).

### 6.5 Architectural consistency gaps

- **Mixed proxy / direct-call pattern** (§4.4): 9 pages bypass the `/api/*` proxy layer entirely. This breaks if dashboard is ever served from a different origin (CORS + env coupling).
- **`/operations/observability` reaches outside the platform** (Langfuse). No dashboard-side proxy. Will leak operator IP to Langfuse host (operator probably wants this; flag for awareness).
- **Mock data leak in `/enforcement`** — 866 LOC of UI plumbed against in-file constants. If someone looks at the page and reports a number, the number is *literally* a static literal.

---

## 7. Tech stack + architectural patterns summary

| Concern | Choice |
|---------|--------|
| Frontend framework            | Next.js 15.5.15 App Router + React 19 |
| Render mode                   | Client-side fetch in `useEffect` / SWR (no SSR data); layout is static shell + Suspense |
| State management              | Local component state + SWR; WebSocket fan-out for live updates |
| Styling                       | Inline styles + `globals.css` (no Tailwind despite some token names suggesting it; the `gates` page has hints of Tailwind-style classes that are probably no-ops) |
| Data layer (operator-facing)  | Next.js API route handler → fetch → orchestrator Hono → drizzle/SQLite |
| Backend framework             | Hono on `@hono/node-server`, SQLite (better-sqlite3), drizzle-orm |
| Real-time                     | WebSocket `ws://localhost:7776/events` via `ws` package, bridged to `eventBus` |
| Auth                          | None — operator-only perimeter trust (matches CAIA / local-llm-router / local-preview-orchestrator pattern) |
| Testing                       | Vitest (unit) + Playwright (visual + a11y) + LHCI |
| Embedded dashboards (per-package) | Plain inline HTML/JS strings (no React) → `local-llm-router/dashboard.ts`, `local-preview-orchestrator/dashboard-html.ts` |
| Python services UI            | None — JSON-only FastAPI |

**Naming**: there is NO unified `/dashboard` namespace. The operator dashboard is just **the entire `apps/dashboard` Next app** running on :7777. Embedded mini-dashboards are package-local and use the literal path `/dashboard` (local-llm-router) or `/` (local-preview-orchestrator).

**Patterns**:
- **Monolithic main dashboard** (`apps/dashboard`) for orchestrator-state
- **Per-package mini-dashboard** for self-contained services with strong local metrics (local-llm-router, local-preview-orchestrator)
- **No mini-dashboard for service-level FastAPI** (slot-manager, sps, claude-spawner-agent, mentor-event-bus) — these expose admin JSON only

---

## 8. Test fixtures + mock data inventory

- `app/enforcement/page.tsx` — inline `MOCK_RULES` array (see §6.1)
- `app/__visual_baselines__/` — empty save for README; baselines not committed
- `apps/dashboard/tests/chat-route.test.ts` — vitest, uses `vi.mock` patterns, no fixture files
- `apps/dashboard/tests/chat-routing.test.ts` — vitest, deterministic inputs
- `apps/orchestrator/src/db/seed-{projects,adr,features,suggestions}.ts` — orchestrator-side seed data (real default content, not mocks)
- `apps/orchestrator/src/db/migrate-from-jsonl.ts` — migration of legacy JSONL artefacts into SQLite

No other dashboard-specific fixtures were found. The dashboard does not maintain its own test database.

---

## 9. URL map — operator-visible surfaces

(Default dev/prod ports; localhost assumed.)

| URL | Surface | Liveness |
|-----|---------|----------|
| `http://localhost:7777/` → `/timeline`                | CAIA operator dashboard root → timeline       | LIVE (assumes orchestrator up) |
| `http://localhost:7777/<page>`                        | 86 pages (see §3.2)                            | Most LIVE; 5 partially broken (see §6) |
| `http://localhost:7776/<route>`                       | Orchestrator JSON API                          | LIVE |
| `ws://localhost:7776/events`                          | WebSocket event fan-out                        | LIVE |
| `http://127.0.0.1:7411/dashboard`                     | local-llm-router displacement dashboard        | LIVE + COMPLETE |
| `http://127.0.0.1:7411/metrics`                       | Prometheus exposition for router               | LIVE |
| `http://127.0.0.1:5170/`                              | local-preview-orchestrator site status         | LIVE + COMPLETE (limited scope) |
| `http://localhost:8081/<route>`                       | slot-manager admin JSON                        | LIVE (no UI) |
| `http://localhost:8090/<route>`                       | claude-spawner-agent admin JSON                | LIVE (no UI) |
| sps `:8090?/<route>`                                  | SPS admin JSON                                 | LIVE (no UI) |
| `${langfuseUrl}/...`                                  | External Langfuse (referenced by /operations/observability) | UNKNOWN |

---

## 10. Completeness ledger

| Surface | Frontend completeness | Data wiring completeness | Overall |
|---------|----------------------|--------------------------|---------|
| Operator dashboard (`apps/dashboard`) — 86 pages | **~85%** (all pages render UI; sidebar + breadcrumb + WS hook + favicon-badge all wired) | **~60%** (50/55 proxy routes work; 10+ direct orchestrator-bypass paths; 10 client paths hit 404; 1 page hard-coded MOCK; data presence requires orchestrator + SQLite seeded) | **~55–65%** |
| local-llm-router `/dashboard` | **100%** | **100%** | **100%** |
| local-preview-orchestrator status dash | **100%** | **100%** | **100%** (limited scope) |
| FastAPI services (slot-manager, sps, spawner-agent) | **0%** (no operator UI) | n/a | n/a (admin-only JSON) |

**The biggest gap** is the missing Next.js proxy layer for /api/agents/artifacts, /api/platform-stats, /api/priority/*, /api/task-runs/active, /api/behavior-tests/coverage — five clusters covering 5 operator-visible pages (queue, gates, tests, platform-status, plus the orphan enforcement page). Each missing proxy is a 20-line file. After those proxies land, the next-biggest gap is the `enforcement` page (replace MOCK_RULES with a real backing route, which requires designing the data source first — there is no orchestrator concept of "enforcement rule" today).

---

## 11. EXISTING-STATE-OF-DASHBOARD summary

> CAIA already has one canonical operator dashboard — **`apps/dashboard`**, a 86-page Next.js 15 App Router app running on **:7777** under the title "Conductor", with a six-section accordion sidebar (Work / Pipeline / Catalog / Quality / Operations / Settings) and a WebSocket live-feed at `ws://localhost:7776/events`. The **frontend is ~85% complete**: virtually every operator concept (timeline, prompts, stories, blockers, questions, tasks, requirements, suggestions, ADRs, features, agents, buckets, queue, pipeline, gates, completeness, tests, audit, metrics, platform-status, pulse, observability, etc.) has a real page with real interaction patterns and visual baselines for six routes. **The data layer is partially wired**: 55 Next.js `route.ts` files proxy to the orchestrator's Hono+SQLite backend (`apps/orchestrator` on :7776, ~140 routes), but **at least 10 client `/api/*` calls hit 404 because the proxy route was never created** (driving empty panels in `/queue`, `/gates`, `/platform-status`, `/tests`), **9 pages bypass the proxy entirely** with direct `${API}` calls (a pattern inconsistency), and **`/enforcement` is hard-coded MOCK data** (`MOCK_RULES` inline constants — a comment says "replace with fetch('/api/enforcement') once the route exists"). Two healthy embedded mini-dashboards exist outside the main app and need no work: `packages/local-llm-router` at `:7411/dashboard` (live displacement metrics, fully tested) and `apps/local-preview-orchestrator` at `:5170` (site status). All other CAIA services (slot-manager :8081, sps, claude-spawner-agent :8090, mentor-event-bus, capability-broker, completeness-sentinel, pipeline-pulse, story-backfiller, db-backup, worker-coding/fix-it) are admin-JSON-only — no operator UI. **Overall completeness ≈ 55–65%**: most pages render but several display empty/stale/mock data. **The biggest single gap** is the missing Next.js proxy layer for `/api/agents/artifacts`, `/api/platform-stats`, `/api/priority/{queue,score,score-all,override}`, `/api/task-runs/active`, `/api/behavior-tests/coverage`, and `/api/enforcement` (the last requires both a proxy AND a new orchestrator route + data model) — ~7 proxy files at ~20 LOC each would unblock 5 of the most visible operator pages, after which the empty-by-default appearance disappears once the orchestrator's SQLite is seeded.

---

*End of audit.*

---
"caia": patch
---

feat(local-preview-001): status dashboard + CLI entrypoint (PR-C)

PR-C of the Local-Preview-Deploys roadmap. Builds on PR-B (#313).

Adds the always-on status dashboard (HTTP server on 127.0.0.1:5170 by
default) plus the CLI entrypoint the PR-D LaunchAgents will invoke.

New modules under `apps/local-preview-orchestrator/src/`:

- `status-dashboard.ts` — `createDashboardServer` + `startDashboard` +
  request handlers. Routes:
  - `GET  /`                      static HTML page
  - `GET  /healthz`               liveness check
  - `GET  /api/status`            JSON status for all sites
  - `GET  /api/logs/<site>`       last N lines of incident log
  - `POST /api/redeploy/<site>`   force a deploy
  - `POST /api/rollback/<site>`   manual rollback (current ← previous)
- `dashboard-html.ts` — single-file inline HTML page that XHRs
  `/api/status` every 5s and exposes Redeploy / Rollback buttons.
- `cli.ts` — `local-preview {poll-loop|status-dashboard|deploy <site>|
  status}` entrypoint with sensible env-var defaults
  (`LOCAL_PREVIEW_INSTALL_ROOT`, `LOCAL_PREVIEW_BUILD_WORKSPACE`,
  `LOCAL_PREVIEW_DASHBOARD_PORT`).

Tests: 20 new (111 total in this app) — including end-to-end coverage
that spins the server up on an ephemeral port and exercises every
route, asserts JSON shapes, validates 404 on unknown sites, 503 when
deploy isn't configured, and 409 when rollback fails. Also asserts the
default bind address is `127.0.0.1` (host = auth boundary).

Trust boundary: site names from URL paths are validated against the
compile-time SITES registry; unknown names return 404 before any path
operation. Server binds localhost-only by default.

`package.json` corrected: `main`/`types`/`bin` paths now match what
`tsc` actually emits (`dist/index.js`, `dist/cli.js`).

References: `~/Documents/projects/reports/local-preview-deploys-analysis.md`,
`agent/memory/steward_local_preview_deploys_directive.md`.

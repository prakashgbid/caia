# @caia-app/roulette-backend (DORMANT — Preservation Copy)

> **Status:** PORTED FOR PRESERVATION — not actively running. Decision pending on whether to revive, refactor into packages, or formally retire.

## What this is

A point-in-time copy of the **entire backend tier** lifted from the archived repo
[`prakashgbid/roulette-advisor-ai`](https://github.com/prakashgbid/roulette-advisor-ai)
on **2026-04-28** as part of remediation item **REM-001** in the
[archived-repos-no-loss audit](../../../reports/archived-repos-no-loss-audit-2026-04-28.md).

The original repo was archived in the no-loss audit. The audit's initial premise — that the
backend was "a feature of `roulette-community`" and had already been migrated — was
incorrect: `roulette-community` is a static Next.js site with no backend, and nothing
had been carried forward. Per the **no-capability-loss policy** (default policy:
"bring everything; retire only with sign-off"), this directory exists so the code is
not lost while a longer-term decision is made.

## Why preserved (not running)

Running this app would require provisioning MongoDB, JWT secrets, Docker, and a
deployment target. None of that is wired up here. The point of this port is **lossless
preservation** of the source artifacts — not revival. If/when a decision is made to
revive it, this directory is the starting point.

## Original architecture (preserved)

- **Runtime:** Node.js + Express 4 (`src/server.js` — entry point)
- **Database:** MongoDB via Mongoose 8 (`src/models/{Bet,Game,User}.js`)
- **Auth:** JWT (`src/utils/jwtUtils.js` + `src/middleware/authMiddleware.js`)
- **API services** (each with `routes.js` + `controllers.js`):
  - `src/services/auth/` — register, login, verify
  - `src/services/game/` — game state, spin results, history
  - `src/services/bet/` — bet placement, validation, payouts
- **Containerization:** `infrastructure/docker/` — `backend.Dockerfile`,
  `frontend.Dockerfile`, `docker-compose.yml`
- **Deployment:** `infrastructure/gcp/kubernetes/` — `backend-deployment.yaml`,
  `frontend-deployment.yaml`, `mongodb-statefulset.yaml`

## Directory layout

```
apps/roulette-backend/
├── README.md                       # This file
├── package.json                    # Dormant manifest (smoke test only)
├── package.json.original           # Original manifest (npm-style, preserved verbatim)
├── package-lock.json.original      # Original npm lockfile, preserved verbatim
├── .env.template                   # Original env template
├── src/                            # Express application
│   ├── server.js                   # Entry point
│   ├── middleware/authMiddleware.js
│   ├── models/                     # Mongoose schemas
│   │   ├── Bet.js
│   │   ├── Game.js
│   │   └── User.js
│   ├── services/                   # Express routers + controllers
│   │   ├── auth/
│   │   ├── bet/
│   │   └── game/
│   ├── types/index.ts
│   └── utils/jwtUtils.js
├── legacy-top-level/
│   └── server.js                   # The slightly-older variant that lived at the
│                                   # top-level src/ in the source repo (1-byte diff)
├── infrastructure/
│   ├── docker/
│   │   ├── backend.Dockerfile
│   │   ├── frontend.Dockerfile
│   │   └── docker-compose.yml
│   └── gcp/kubernetes/
│       ├── backend-deployment.yaml
│       ├── frontend-deployment.yaml
│       └── mongodb-statefulset.yaml
└── tests/
    └── preservation-smoke.test.js  # DoD smoke test — asserts files exist
```

## CI behaviour

This app is **excluded from CAIA's active build/test/lint/typecheck pipelines**:

- No `build`, `lint`, or `typecheck` script in `package.json` — Turbo skips it for
  those tasks.
- The `test` script runs `tests/preservation-smoke.test.js`, a self-contained
  Node-only assertion script that verifies the directory still has the expected
  files. It has zero external dependencies (no jest required).
- The original deps (`express`, `mongoose`, `bcryptjs`, …) are intentionally **not**
  in this `package.json` so `pnpm install` doesn't fetch them. They are preserved
  verbatim in `package.json.original`.

## How to revive (if/when decided)

1. `cp package.json.original package.json` (restore original deps)
2. `cp package-lock.json.original package-lock.json` (or convert to pnpm lockfile)
3. Provision MongoDB and set env vars per `.env.template`
4. `npm install && npm run dev`
5. Decide whether to refactor into CAIA packages (e.g. `@chiefaia/auth-service`,
   `@chiefaia/bet-service`) or keep as a single app.

## Provenance

| Field | Value |
|-------|-------|
| Source repo | `prakashgbid/roulette-advisor-ai` (archived) |
| Source paths | `apps/backend/`, `src/server.js`, `infrastructure/{docker,gcp}/` |
| Source file count | 23 |
| Ported on | 2026-04-28 |
| Ported by | REM-001 of archived-repos-no-loss-audit-2026-04-28 |
| Policy | No-capability-loss (default: bring everything; retire only with sign-off) |
| Status | DORMANT — preserved, not running |

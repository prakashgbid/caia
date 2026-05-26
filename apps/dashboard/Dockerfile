# syntax=docker/dockerfile:1.7
#
# chiefaia-dashboard — Next.js 15 (App Router) standalone image.
#
# Build context MUST be the monorepo root because the dashboard is a
# pnpm workspace package and the standalone tracer walks the workspace
# at build time. CI uses `context: .` with `file: apps/dashboard/Dockerfile`.
#
# Stages:
#   deps      — install full workspace (cached on pnpm-lock.yaml)
#   builder   — `next build` produces .next/standalone + .next/static
#   runner    — minimal runtime: only the standalone bundle, public/, static
#
# Final image:
#   - base: node:20-alpine
#   - non-root uid 1001 (nextjs:nodejs)
#   - listens on $PORT (default 3000)
#   - HEALTHCHECK hits /api/healthz over HTTP
#
# Why we vendor `node_modules/@chiefaia/tracing` into the runner
# explicitly: the OTel SDK is dynamically imported by
# `instrumentation.ts` at boot, and `next build` does NOT pull dynamic
# imports into `.next/standalone` (Next traces static imports only).
# Without the explicit copy, the runtime fails with
# "Cannot find module '@opentelemetry/sdk-node'" the first time a
# request lands. The standalone tracer DOES bundle statically-imported
# workspace packages — those are already inside .next/standalone.

# ─── deps ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /repo

# pnpm via corepack — the lockfile is pnpm 9, matching the repo's
# packageManager pin (see root package.json).
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

# Copy workspace manifest + lockfile first for layer cache stability.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps apps
COPY packages packages
COPY configs configs
COPY services services
COPY templates templates
COPY tsconfig.base.json turbo.json ./

# Frozen install for reproducible builds. --prefer-offline lets the
# build use the BuildKit-cached pnpm-store mount when present.
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

# ─── builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate

COPY --from=deps /repo /repo

# Build the workspace deps the dashboard imports + the Next.js bundle.
# The dashboard's `build` script already runs the workspace filter
# chain (`@caia/billing`, `@caia/ui`, `@chiefaia/event-bus-nats`,
# `@chiefaia/tracing`) before `next build`. NEXT_TELEMETRY_DISABLED is
# set on the runner too — set here so the build step doesn't phone home.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter @caia-app/dashboard build

# ─── runner ───────────────────────────────────────────────────────────
FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone bundle (server.js + traced node_modules subset). Because
# next.config.js sets outputFileTracingRoot to the monorepo root, the
# standalone tree mirrors the repo path layout: the server entrypoint
# lives at apps/dashboard/server.js inside the standalone tree.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/dashboard/public ./apps/dashboard/public

# Explicitly vendor the OTel SDK transitive closure. instrumentation.ts
# loads `@chiefaia/tracing` via dynamic import — Next's tracer doesn't
# follow those, so the standalone bundle is missing it. Copying the
# whole tree (including its statically-imported peers) is the simplest
# reliable fix and adds ~30 MB.
COPY --from=builder --chown=nextjs:nodejs /repo/packages/tracing/dist ./node_modules/@chiefaia/tracing/dist
COPY --from=builder --chown=nextjs:nodejs /repo/packages/tracing/package.json ./node_modules/@chiefaia/tracing/package.json
COPY --from=builder --chown=nextjs:nodejs /repo/node_modules/@opentelemetry ./node_modules/@opentelemetry

USER nextjs
EXPOSE 3000

# Liveness probe target. K8s readinessProbe also hits /api/healthz; the
# /api/readyz endpoint additionally checks pg + infisical + nats but
# is not part of the in-image HEALTHCHECK because docker-only checks
# should be cheap.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1

# server.js is the Next.js standalone entrypoint. Path reflects the
# outputFileTracingRoot configuration in next.config.js.
CMD ["node", "apps/dashboard/server.js"]

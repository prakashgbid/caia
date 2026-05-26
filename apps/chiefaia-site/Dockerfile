# syntax=docker/dockerfile:1.7
#
# chiefaia-site — Next.js 15 (App Router) standalone marketing image.
#
# Build context MUST be the monorepo root because chiefaia-site is a
# pnpm workspace package and the standalone tracer walks the workspace
# at build time. CI uses `context: .` with `file: apps/chiefaia-site/Dockerfile`.
#
# Stages mirror apps/dashboard/Dockerfile (A1+A2) — same conventions
# per ADR-065 reuse-first:
#   deps    — install full workspace (cached on pnpm-lock.yaml)
#   builder — `next build` produces .next/standalone + .next/static
#   runner  — minimal runtime: standalone bundle + public/ + static
#
# Final image:
#   - base: node:20-alpine
#   - non-root uid 1001 (nextjs:nodejs)
#   - listens on $PORT (default 3000)
#   - HEALTHCHECK hits /api/healthz over HTTP
#
# OTel vendoring: instrumentation.ts uses `await import('@chiefaia/
# tracing')` — a dynamic import with a STATIC string argument. Next.js
# 15's standalone tracer follows static-string dynamic imports, so the
# transitive OTel SDK closure ends up in .next/standalone automatically.
# We add a build-time verification step to fail fast if the trace ever
# stops including it (avoids "Cannot find module" surfacing only at
# runtime). The dashboard Dockerfile also vendored OTel explicitly,
# but pnpm's strict isolation means `node_modules/@opentelemetry` does
# not exist at the workspace root — the only reliable copy source is
# the standalone tree itself, which Next has already populated.

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

# Build workspace deps chiefaia-site imports, then the Next.js bundle.
# @caia/ui and @chiefaia/tracing must be compiled to dist/ before
# `next build` traces them.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter @caia/ui --filter @chiefaia/tracing build
RUN pnpm --filter @caia-app/chiefaia-site build

# Verification: the standalone tracer must have included
# @chiefaia/tracing. If this directory is missing, the runtime
# `await import('@chiefaia/tracing')` in instrumentation.ts will throw
# on first request — fail the build now rather than discovering it in
# production. Path reflects outputFileTracingRoot=<repo>.
RUN test -d /repo/apps/chiefaia-site/.next/standalone/node_modules/@chiefaia/tracing \
    || (echo "ERROR: standalone bundle missing @chiefaia/tracing — instrumentation.ts will fail at boot. Check next.config.mjs outputFileTracingRoot and the dynamic-import path." && exit 1)

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
# next.config.mjs sets outputFileTracingRoot to the monorepo root, the
# standalone tree mirrors the repo path layout: the server entrypoint
# lives at apps/chiefaia-site/server.js inside the standalone tree.
COPY --from=builder --chown=nextjs:nodejs /repo/apps/chiefaia-site/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/chiefaia-site/.next/static ./apps/chiefaia-site/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/chiefaia-site/public ./apps/chiefaia-site/public

# Refresh @chiefaia/tracing's dist files explicitly. Next's tracer
# copies the source files, but defensive overwriting with the built
# dist ensures the runtime sees exactly what `pnpm build` produced
# (e.g. after a fresh `tsc` pass). Adds ~50 KB.
COPY --from=builder --chown=nextjs:nodejs /repo/packages/tracing/dist ./node_modules/@chiefaia/tracing/dist
COPY --from=builder --chown=nextjs:nodejs /repo/packages/tracing/package.json ./node_modules/@chiefaia/tracing/package.json

USER nextjs
EXPOSE 3000

# Liveness probe target. K8s readinessProbe also hits /api/readyz.
# In-image HEALTHCHECK uses healthz because docker-level checks should
# be cheap and dependency-free.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1

# server.js is the Next.js standalone entrypoint. Path reflects the
# outputFileTracingRoot configuration in next.config.mjs.
CMD ["node", "apps/chiefaia-site/server.js"]

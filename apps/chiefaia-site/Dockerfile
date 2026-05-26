# syntax=docker/dockerfile:1.7
#
# chiefaia-site — Next.js 15 (App Router) standalone marketing image.
#
# Stages mirror apps/dashboard/Dockerfile (PR #612 / A1+A2) — same
# conventions per ADR-065 reuse-first:
#   deps    — install full workspace (cached on pnpm-lock.yaml)
#   builder — `next build` produces .next/standalone + .next/static,
#             then vendors @chiefaia/tracing + @opentelemetry into it
#   runner  — minimal runtime: standalone bundle + public/ + static
#
# Final image:
#   - base: node:20-alpine, non-root uid 1001 (nextjs:nodejs)
#   - listens on $PORT (default 3000)
#   - HEALTHCHECK hits /api/healthz over HTTP
#
# OTel vendoring (the hard part): instrumentation.ts uses
# `await import('@chiefaia/tracing')` because the file is loaded for
# BOTH edge and node runtimes and OTel NodeSDK is Node-only. The
# dynamic import gates on NEXT_RUNTIME === 'nodejs'. Empirically:
# Next.js 15's standalone tracer does NOT follow this dynamic import
# (literal string arg notwithstanding) — first build of this
# Dockerfile failed the verification check with @chiefaia/* missing
# from the standalone node_modules. Fix below dereferences pnpm's
# symlink graph.

FROM node:20-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc* ./
COPY apps apps
COPY packages packages
COPY configs configs
COPY services services
COPY templates templates
COPY tsconfig.base.json turbo.json ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --prefer-offline

FROM node:20-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
COPY --from=deps /repo /repo
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN pnpm --filter @caia/ui --filter @chiefaia/tracing build
RUN pnpm --filter @caia-app/chiefaia-site build

# Vendor @chiefaia/tracing + its OTel transitive closure into the
# standalone tree. Next.js's tracer leaves them out because the
# import is dynamic (see header). We dereference pnpm's symlink graph
# with `cp -rL` so the standalone node_modules contains real files,
# not dangling symlinks. The `.pnpm/@chiefaia+tracing@*` directory
# has both @chiefaia/tracing AND every @opentelemetry/* peer in one
# node_modules — the cleanest single source.
RUN set -eux; \
    STANDALONE=/repo/apps/chiefaia-site/.next/standalone; \
    TRACING_PNPM=$(ls -d /repo/apps/chiefaia-site/node_modules/.pnpm/@chiefaia+tracing@* 2>/dev/null | head -1); \
    if [ -z "$TRACING_PNPM" ]; then \
        TRACING_PNPM=$(ls -d /repo/node_modules/.pnpm/@chiefaia+tracing@* 2>/dev/null | head -1); \
    fi; \
    test -n "$TRACING_PNPM" || { echo "ERROR: cannot find @chiefaia/tracing in any .pnpm dir" >&2; exit 1; }; \
    echo "Vendor source: $TRACING_PNPM"; \
    mkdir -p "$STANDALONE/node_modules/@chiefaia"; \
    cp -rL "$TRACING_PNPM/node_modules/@chiefaia/tracing" "$STANDALONE/node_modules/@chiefaia/tracing"; \
    if [ -d "$TRACING_PNPM/node_modules/@opentelemetry" ]; then \
        mkdir -p "$STANDALONE/node_modules/@opentelemetry"; \
        for pkg in "$TRACING_PNPM"/node_modules/@opentelemetry/*; do \
            name=$(basename "$pkg"); \
            if [ ! -e "$STANDALONE/node_modules/@opentelemetry/$name" ]; then \
                cp -rL "$pkg" "$STANDALONE/node_modules/@opentelemetry/"; \
            fi; \
        done; \
    fi

RUN test -d /repo/apps/chiefaia-site/.next/standalone/node_modules/@chiefaia/tracing \
    || (echo "ERROR: vendoring step did not place @chiefaia/tracing into the standalone bundle." && exit 1)
RUN test -d /repo/apps/chiefaia-site/.next/standalone/node_modules/@opentelemetry/sdk-node \
    || (echo "ERROR: vendoring step did not place @opentelemetry/sdk-node into the standalone bundle." && exit 1)

FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /repo/apps/chiefaia-site/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/chiefaia-site/.next/static ./apps/chiefaia-site/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/chiefaia-site/public ./apps/chiefaia-site/public
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "apps/chiefaia-site/server.js"]

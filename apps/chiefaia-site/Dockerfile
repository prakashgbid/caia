# syntax=docker/dockerfile:1.7
#
# chiefaia-site — Next.js 15 (App Router) standalone marketing image.
#
# OTel vendoring: instrumentation.ts uses `await import('@chiefaia/
# tracing')` because it's loaded for BOTH edge and node runtimes and
# OTel NodeSDK is Node-only. Next.js 15's standalone tracer does NOT
# follow this dynamic import even with a literal-string arg —
# empirically confirmed by the first failed build.
#
# Fix: copy /repo/packages/tracing (workspace package with built dist)
# and /repo/packages/tracing/node_modules/@opentelemetry (where pnpm
# parks the OTel transitive closure as symlinks to .pnpm/) into the
# standalone tree. `cp -rL` dereferences pnpm's symlinks. Adds ~25 MB.

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
# standalone tree. Source: /repo/packages/tracing (the workspace
# package source + built dist) and /repo/packages/tracing/
# node_modules/@opentelemetry (where pnpm parks the OTel symlinks
# pointing into .pnpm/). cp -rL dereferences them.
RUN set -eux; \
    STANDALONE=/repo/apps/chiefaia-site/.next/standalone; \
    TRACING_SRC=/repo/packages/tracing; \
    test -d "$TRACING_SRC/dist" || { echo "ERROR: packages/tracing/dist missing — was pnpm --filter @chiefaia/tracing build run?" >&2; exit 1; }; \
    test -d "$TRACING_SRC/node_modules/@opentelemetry" || { echo "ERROR: packages/tracing/node_modules/@opentelemetry missing — pnpm install layout changed?" >&2; ls -la "$TRACING_SRC/node_modules/" 2>&1 || true; exit 1; }; \
    mkdir -p "$STANDALONE/node_modules/@chiefaia/tracing"; \
    cp -rL "$TRACING_SRC/dist" "$STANDALONE/node_modules/@chiefaia/tracing/dist"; \
    cp "$TRACING_SRC/package.json" "$STANDALONE/node_modules/@chiefaia/tracing/package.json"; \
    mkdir -p "$STANDALONE/node_modules/@opentelemetry"; \
    for pkg in "$TRACING_SRC"/node_modules/@opentelemetry/*; do \
        name=$(basename "$pkg"); \
        if [ ! -e "$STANDALONE/node_modules/@opentelemetry/$name" ]; then \
            cp -rL "$pkg" "$STANDALONE/node_modules/@opentelemetry/$name"; \
        fi; \
    done

RUN test -d /repo/apps/chiefaia-site/.next/standalone/node_modules/@chiefaia/tracing/dist \
    || (echo "ERROR: vendoring step did not place @chiefaia/tracing/dist into the standalone bundle." && exit 1)
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

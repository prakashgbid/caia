# syntax=docker/dockerfile:1.7
# chiefaia-dashboard — Next.js 15 standalone, node:20-alpine, non-root.
# Build context: monorepo root.

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
RUN pnpm --filter @caia-app/dashboard build

FROM node:20-alpine AS runner
RUN apk add --no-cache libc6-compat wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
COPY --from=builder --chown=nextjs:nodejs /repo/apps/dashboard/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER nextjs
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/healthz || exit 1
CMD ["node", "apps/dashboard/server.js"]

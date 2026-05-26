---
'@caia-app/dashboard': minor
---

feat(apps/dashboard): Docker image + K8s deploy foundation (Phase A1+A2)

Ships the runtime substrate the wizard needs to be reachable from a
browser. Without this, every wizard step UI lives only in the build.

Concretely:

- `apps/dashboard/Dockerfile` — multi-stage Next.js 15 standalone image
  on `node:20-alpine`, non-root, with a `/api/healthz` HEALTHCHECK.
  Vendors `@chiefaia/tracing` + `@opentelemetry/*` into the runner
  because `instrumentation.ts` loads them via dynamic import.
- `apps/dashboard/instrumentation.ts` — wires `initTracing` from
  `@chiefaia/tracing` v0.3.0 so OTel traces flow to in-cluster Tempo.
- `apps/dashboard/app/api/healthz/route.ts` — pure liveness.
- `apps/dashboard/app/api/readyz/route.ts` — pg + Infisical + NATS
  reachability gated by the existing `BUS_BACKEND_NATS_FOR_EVENT_TYPES`
  feature flag.
- `apps/dashboard/middleware.ts` — matcher now excludes `/api/healthz`
  and `/api/readyz` so kubelet probes don't 302 to /sign-in.
- `apps/dashboard/next.config.js` — `output: 'standalone'` +
  `outputFileTracingRoot` so the standalone tracer pulls workspace
  deps into the image.
- `infra/dashboard/` — Deployment, ServiceAccount, NetworkPolicy,
  Service (replaces the placeholder), ConfigMap, Secret template,
  README with operator runbook + rollback procedure.
- `.github/workflows/dashboard-publish.yml` — on push to develop
  touching the dashboard or its workspace deps, builds with Buildx +
  GH-Actions cache and pushes to `ghcr.io/prakashgbid/chiefaia-dashboard`
  as `:develop`, `:develop-<sha>`, and `:latest`. Rollout is manual in
  V1 (documented in `infra/dashboard/README.md`).

Reuse-first compliance:
- Pod / container securityContext mirrors the existing chiefaia-web
  Deployment pattern.
- NetworkPolicy egress rules follow `infra/nats/50-networkpolicy.yaml`.
- Tracing wired via `@chiefaia/tracing` (PR #608), the canonical OTel
  surface — no parallel `@chiefaia/otel`.
- `@caia/onboarding`, `@caia/grand-idea`, `@caia/business-proposal-generator`,
  `@caia/atlas-ui`, `@caia/state-machine`, `@caia/ui`,
  `@chiefaia/event-bus-nats`, `@chiefaia/event-bus-internal` all
  consumed via workspace deps in the existing `package.json` (no new
  packages introduced).

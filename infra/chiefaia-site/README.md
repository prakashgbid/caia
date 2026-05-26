# infra/chiefaia-site/

Kubernetes manifests for the **chiefaia-site** marketing app (Next.js 15 — PR #602). Replaces the legacy `chiefaia-web` nginx placeholder pod that previously served `chiefaia.com`.

## Files

| File | What it is |
| --- | --- |
| `10-deployment.yaml` | `Deployment/chiefaia-web` running the Next.js standalone image |
| `20-service.yaml` | `Service/chiefaia-web` — same name as the prior nginx Service; only `targetPort` flips from 8080 → 3000 |
| `30-configmap.yaml` | `ConfigMap/chiefaia-site-config` — non-secret env (site URL, OTLP endpoint, etc.) |
| `40-secret-template.yaml` | Template for `Secret/chiefaia-site-secrets` (optional, not auto-applied) |

The Istio routing for `chiefaia.com` lives separately in `infra/istio/chiefaia/20-virtualservice-web.yaml` (PR #609); it points at `chiefaia-web.chiefaia.svc.cluster.local:80` — unchanged here.

## First-time apply (operator runbook)

Pre-reqs: kubectl context pointing at the K3s cluster; the image `ghcr.io/prakashgbid/chiefaia-site:latest` exists on GHCR (built by `.github/workflows/chiefaia-site-publish.yml` on push to `develop`).

```bash
# 1. Sanity-check the live state.
kubectl get deployment chiefaia-web -n chiefaia -o jsonpath='{.spec.template.spec.containers[0].image}'
# Expect: nginxinc/nginx-unprivileged:1.27-alpine

# 2. Apply ConfigMap first so the new pod can resolve envFrom on first roll.
kubectl apply -f infra/chiefaia-site/30-configmap.yaml

# 3. (Optional) Create the Secret if /api/contact is wired to a real provider.
#    Skip this for the first rollout — secretRef is marked optional.
# kubectl create secret generic chiefaia-site-secrets -n chiefaia \
#   --from-literal=CONTACT_FORM_PROVIDER_API_KEY=<value>

# 4. Apply the updated Service (targetPort 8080 → 3000).
kubectl apply -f infra/chiefaia-site/20-service.yaml

# 5. Apply the Deployment. Rolling update: new pod comes up before old
#    one is killed (maxSurge=1, maxUnavailable=0).
kubectl apply -f infra/chiefaia-site/10-deployment.yaml

# 6. Watch the rollout.
kubectl rollout status deployment/chiefaia-web -n chiefaia --timeout=120s

# 7. Verify endpoints in the Service back the new pod.
kubectl get endpoints chiefaia-web -n chiefaia

# 8. Smoke-check chiefaia.com.
curl -I https://chiefaia.com
curl -s https://chiefaia.com/pricing | head -20
curl -s https://chiefaia.com/legal/privacy | head -20
```

The new pod responds with Next.js fingerprints (no `Server: nginx` header; X-Powered-By is suppressed via `poweredByHeader: false` in `next.config.mjs`, but HTML carries the Next.js asset hashing and the `<link rel="preload" as="script">` pattern that's distinctive of a Next.js render).

## Rollback

The nginx-placeholder Deployment is the prior revision. To revert:

```bash
kubectl rollout undo deployment/chiefaia-web -n chiefaia
# or, to go to a specific revision:
kubectl rollout history deployment/chiefaia-web -n chiefaia
kubectl rollout undo deployment/chiefaia-web -n chiefaia --to-revision=<N>
```

The pre-existing `chiefaia-web-content` ConfigMap (nginx.conf + index.html + healthz) is intentionally left in the cluster so a full rollback to the static-HTML placeholder remains a one-command operation.

## Image tags

| Tag | Meaning |
| --- | --- |
| `latest` | Most recent successful build from `develop`. Useful for a non-pinned rollout. |
| `develop-<sha>` | Specific commit on `develop`. Pin this in `10-deployment.yaml` for repeatable rollouts. |

CI: `.github/workflows/chiefaia-site-publish.yml` (push-to-`develop` with paths-filter on `apps/chiefaia-site/`).

## Probes

- **Liveness** — `GET /api/healthz` — pure liveness, no I/O.
- **Readiness** — `GET /api/readyz` — confirms process is up; no external deps checked today (marketing site has none). Add provider reachability when `/api/contact` moves off its stub.
- **Startup** — `GET /api/healthz` with a 60 s budget for Next.js cold-start + OTel SDK init.

## OTel

The Deployment's ConfigMap sets `OTEL_EXPORTER_OTLP_ENDPOINT=http://tempo.chiefaia.svc.cluster.local:4318`. `apps/chiefaia-site/instrumentation.ts` calls `initTracing({ serviceName: 'chiefaia-site' })` once per Node process; spans appear in Grafana under `service.name = chiefaia-site`.

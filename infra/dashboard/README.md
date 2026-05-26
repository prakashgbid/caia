# chiefaia-dashboard — runtime manifests

Kubernetes manifests for the `chiefaia-dashboard` Deployment. This is
the OPERATOR-facing system served at `ops.chiefaia.com` (Cloudflare
Access gated). The customer-facing half lives at
`dashboard.chiefaia.com` (`apps/wizard`, `infra/wizard/`).

## File map

| File | Purpose |
| --- | --- |
| `10-deployment.yaml` | Deployment + ServiceAccount + NetworkPolicy |
| `20-service.yaml`    | ClusterIP Service — replaces the placeholder Service |
| `30-configmap.yaml`  | Non-secret runtime env (OTel, NATS coords, auth mode) |
| `40-secret-template.yaml` | TEMPLATE — real Secret lands via Infisical or `kubectl create secret` |

Image is published to `ghcr.io/prakashgbid/chiefaia-dashboard` by
`.github/workflows/dashboard-publish.yml` on every push to `develop`
touching `apps/dashboard/**` or its workspace deps.

## First-time deploy

```bash
# 1. Materialise the real secret. EDGE_SHARED_SECRET is required when
#    WIZARD_AUTH_MODE=cf-edge-only is set in the ConfigMap (it is, see
#    "Operator auth mode" below).
kubectl create secret generic chiefaia-dashboard-secrets \
  --namespace chiefaia \
  --from-literal=GLOBAL_POSTGRES_URL='<...>' \
  --from-literal=INFISICAL_ADMIN_TOKEN='<...>' \
  --from-literal=NATS_NKEY_SEED='<...>' \
  --from-literal=EDGE_SHARED_SECRET="$(openssl rand -hex 16)"

# 2. Apply the manifests in order (the Service flip last, so the
#    placeholder keeps returning 503 until pods are Ready):
kubectl apply -f infra/dashboard/30-configmap.yaml
kubectl apply -f infra/dashboard/10-deployment.yaml
kubectl apply -f infra/dashboard/20-service.yaml

# 3. Wait for rollout. 1 replica + maxSurge=1 means this is fast.
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s

# 4. Smoke the route from the operator's allowlisted IP — expect 200.
curl -I https://ops.chiefaia.com
```

## Updating to a new image

```bash
kubectl -n chiefaia set image deployment/chiefaia-dashboard \
  dashboard=ghcr.io/prakashgbid/chiefaia-dashboard:develop-<sha>
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s
```

## Rollback

The Deployment keeps the last 5 ReplicaSets (`revisionHistoryLimit: 5`),
so any of the last 5 rollouts can be reverted without an image push.

```bash
kubectl rollout history deployment/chiefaia-dashboard --namespace chiefaia
kubectl rollout undo deployment/chiefaia-dashboard --namespace chiefaia
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s
```

## Verification checklist

```bash
kubectl get deploy chiefaia-dashboard -n chiefaia
kubectl get pods -n chiefaia -l app.kubernetes.io/name=chiefaia-dashboard
curl -I https://ops.chiefaia.com

kubectl exec -n chiefaia deploy/tempo -- \
  curl -s 'http://localhost:3200/api/search?tags=service.name%3Dchiefaia-dashboard' \
  | head -50
```

## Operator auth mode (`WIZARD_AUTH_MODE`)

The Next.js middleware in `apps/dashboard/middleware.ts` is a verbatim
port of the wizard middleware (REUSE-FIRST EXCEPTION; the shared
`@chiefaia/wizard-auth` package extraction is tracked as a B-task in
`PLAN.md`). It supports the same three modes via the
`WIZARD_AUTH_MODE` env var. See `apps/dashboard/lib/auth/edge-bypass.ts`
for the source of truth.

| Mode | Behaviour |
| --- | --- |
| `cloudflare` *(default)* | Strict JWT. Missing/invalid `CF_Authorization` cookie → 307 redirect to `/sign-in`. |
| `cf-edge-only`            | **Defence-in-depth bypass.** All three checks must pass: (a) `Cf-Ray` header present (CF-injected, absent on direct-to-origin), (b) `Cf-Connecting-Ip` ∈ `BYPASS_ALLOWED_IPS`, (c) `X-Caia-Edge-Token` matches `EDGE_SHARED_SECRET` (constant-time compare). Any failure → falls through to strict JWT path. |
| `disabled`                | Middleware no-op. **Never run with `disabled` in production.** Local dev only. |

### Why `cf-edge-only` is the live mode today

The dashboard is the SINGLE-OPERATOR system. Cloudflare Access has an
IP-allowlist policy (precedence=1) that lets the operator's Mac WAN IP
reach origin without an Access login, but the bypass policy doesn't
issue a `CF_Authorization` JWT — so the strict middleware path 307s
the operator's browser to `/sign-in`.

`cf-edge-only` trusts requests that *clearly* came through Cloudflare
(via the three checks) and resolves the tenant identity from
`BYPASS_TENANT_EMAIL`. For the single-operator dashboard, that fixed
fallback tenant is correct by design.

### Security note

`cf-edge-only` is only safe when origin access is pinned to Cloudflare
such that direct-to-origin requests cannot present a valid
`X-Caia-Edge-Token`. The current deployment achieves this via:

1. Cloudflare WAF Transform Rule (see operator follow-up below) that
   *unconditionally* sets `X-Caia-Edge-Token` to the value of the
   `EDGE_SHARED_SECRET` Cloudflare workers-secret, OVERWRITING any
   client-supplied value at the edge.
2. The constant-time compare in `lib/auth/edge-bypass.ts` prevents
   timing side-channels on the secret check.

If you cannot guarantee #1 at the edge, leave `WIZARD_AUTH_MODE` at
the default `cloudflare` and pursue the WARP+Touch-ID flow (in-flight)
instead.

Operator must **never** set `WIZARD_AUTH_MODE=disabled` in production.

### Operator follow-up: Cloudflare WAF Transform Rule

Set up the Transform Rule that injects `X-Caia-Edge-Token` on every
request reaching the origin via the `ops.chiefaia.com` host:

1. Cloudflare dashboard → **Rules → Transform Rules → HTTP Request Header Modification**
2. Create rule:
   - **Rule name:** `inject-caia-edge-token-dashboard`
   - **If incoming request matches:** `(http.host eq "ops.chiefaia.com")`
   - **Then... Modify request header:**
     - **Set static** name `X-Caia-Edge-Token` value `<value of EDGE_SHARED_SECRET>`
   - Deploy.
3. Verify with `curl -I https://ops.chiefaia.com` from the operator's allowlisted Mac — expect HTTP 200, not 307.

The WARP+Touch-ID task (in-flight) deprecates this entire mode.

### Env vars at a glance

| Var | Required when | Value |
| --- | --- | --- |
| `WIZARD_AUTH_MODE` | always | `cloudflare` \| `cf-edge-only` \| `disabled` |
| `BYPASS_ALLOWED_IPS` | mode=`cf-edge-only` | CSV of allowed `Cf-Connecting-Ip` values |
| `BYPASS_TENANT_EMAIL` | mode=`cf-edge-only` | Email used for tenant resolution in bypass path |
| `EDGE_SHARED_SECRET` (Secret) | mode=`cf-edge-only` | 32-char random hex; set via `openssl rand -hex 16` |

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Pod CrashLoopBackOff with "Cannot find module '@opentelemetry/sdk-node'" | Standalone bundle missed the dynamic import | Confirm Dockerfile copies `/repo/node_modules/@opentelemetry` into the runner stage |
| readinessProbe flapping with 503 | Postgres / Infisical / NATS unreachable | `kubectl logs` — readyz logs a `readyz.fail` JSON line listing the failing dep |
| Route returns 503 "no healthy upstream" | Service still selects 0 pods | Re-apply `20-service.yaml` AFTER the Deployment is Ready |
| Route returns 307 to `/sign-in` from the operator's Mac | `EDGE_SHARED_SECRET` mismatch between K8s Secret and CF Transform Rule, OR Transform Rule missing | Confirm `kubectl get secret chiefaia-dashboard-secrets -o jsonpath='{.data.EDGE_SHARED_SECRET}' \| base64 -d` matches the value in the Cloudflare Transform Rule |
| Route returns 200/HTML for non-allowlisted clients | Cloudflare Access policy mis-ordered | Confirm Access bypass policy is at precedence=1 and limited to the operator's IP |
| No traces in Tempo | Sampling, env, or network | Check `OTEL_EXPORTER_OTLP_ENDPOINT` in the pod env; confirm the NetworkPolicy allows port 4318 → tempo |

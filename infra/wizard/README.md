# chiefaia-wizard — runtime manifests

Kubernetes manifests for the customer-facing wizard Deployment served
at `dashboard.chiefaia.com` (Cloudflare Access gated for customers).

This is the customer half of the apps split documented in
`agent-memory/standing_rule_wizard_ops_app_split_2026-05-26.md`:

| Subdomain | App | Manifest dir |
|---|---|---|
| `dashboard.chiefaia.com` | `apps/wizard` (`chiefaia-wizard`) | `infra/wizard/` (this dir) |
| `ops.chiefaia.com`       | `apps/dashboard` (`chiefaia-dashboard`) | `infra/dashboard/` |
| `chiefaia.com`           | `apps/chiefaia-site` (`chiefaia-site`) | `infra/chiefaia-site/` |

## File map

| File | Purpose |
| --- | --- |
| `10-deployment.yaml` | Deployment + ServiceAccount + NetworkPolicy |
| `20-service.yaml`    | ClusterIP Service (port 80 → 3000) |
| `30-configmap.yaml`  | Non-secret runtime env (OTel, NATS coords, auth mode) |
| `40-secret-template.yaml` | TEMPLATE — real Secret lands via Infisical or `kubectl create secret` |

Image is published to `ghcr.io/prakashgbid/chiefaia-wizard` by
`.github/workflows/wizard-publish.yml` on every push to `develop`
touching `apps/wizard/**` or its workspace deps.

## First-time deploy

```bash
# 1. Materialise the real secret. EDGE_SHARED_SECRET is required when
#    WIZARD_AUTH_MODE=cf-edge-only is set in the ConfigMap (it is, see
#    "Wizard auth mode" below).
kubectl create secret generic chiefaia-wizard-secrets \
  --namespace chiefaia \
  --from-literal=GLOBAL_POSTGRES_URL='<...>' \
  --from-literal=INFISICAL_ADMIN_TOKEN='<...>' \
  --from-literal=NATS_NKEY_SEED='<...>' \
  --from-literal=CF_ACCESS_AUD='<application-aud>' \
  --from-literal=EDGE_SHARED_SECRET="$(openssl rand -hex 16)"

# 2. Apply the manifests:
kubectl apply -f infra/wizard/30-configmap.yaml
kubectl apply -f infra/wizard/10-deployment.yaml
kubectl apply -f infra/wizard/20-service.yaml

# 3. Wait for rollout.
kubectl rollout status deployment/chiefaia-wizard \
  --namespace chiefaia --timeout=120s

# 4. Smoke the route. Cloudflare Access returns 302 to the Access
#    login page for non-allowlisted clients — that's success at the
#    routing layer. From the operator's allowlisted IP (with the
#    Transform Rule active), expect HTTP 200 directly.
curl -I https://dashboard.chiefaia.com
```

## Updating to a new image

```bash
kubectl -n chiefaia set image deployment/chiefaia-wizard \
  wizard=ghcr.io/prakashgbid/chiefaia-wizard:develop-<sha>
kubectl rollout status deployment/chiefaia-wizard \
  --namespace chiefaia --timeout=120s
```

## Rollback

```bash
kubectl rollout undo deployment/chiefaia-wizard --namespace chiefaia
kubectl rollout status deployment/chiefaia-wizard \
  --namespace chiefaia --timeout=120s
```

## Verification checklist

```bash
kubectl get deploy chiefaia-wizard -n chiefaia
kubectl get pods -n chiefaia -l app.kubernetes.io/name=chiefaia-wizard
curl -I https://dashboard.chiefaia.com

# Tempo traces — confirm chiefaia-wizard shows up
kubectl exec -n chiefaia deploy/tempo -- \
  curl -s 'http://localhost:3200/api/search?tags=service.name%3Dchiefaia-wizard' \
  | head -50
```

## Wizard auth mode (`WIZARD_AUTH_MODE`)

The Next.js middleware in `apps/wizard/middleware.ts` supports three
modes via the `WIZARD_AUTH_MODE` env var (driven by this ConfigMap).
See `apps/wizard/lib/auth/edge-bypass.ts` for the source of truth.

| Mode | Behaviour |
| --- | --- |
| `cloudflare` *(default)* | Strict JWT. Missing/invalid `CF_Authorization` cookie → 307 redirect to `/sign-in`. |
| `cf-edge-only`            | **Defence-in-depth bypass.** All three checks must pass: (a) `Cf-Ray` header present (CF-injected, absent on direct-to-origin), (b) `Cf-Connecting-Ip` ∈ `BYPASS_ALLOWED_IPS`, (c) `X-Caia-Edge-Token` matches `EDGE_SHARED_SECRET` (constant-time compare). Any failure → falls through to strict JWT path. |
| `disabled`                | Middleware no-op. **Never run with `disabled` in production.** Local dev only. |

### Why `cf-edge-only` is the live mode today

Cloudflare Access has an IP-allowlist policy (precedence=1) that lets
the operator's Mac WAN IP `69.118.44.175` reach origin without an
Access login. The bypass policy returns a 200 instead of issuing a
`CF_Authorization` JWT cookie, so the strict middleware path 307s the
operator's browser to `/sign-in` — defeating the bypass.

`cf-edge-only` resolves this by trusting requests that *clearly* came
through Cloudflare (via the three checks) and resolving the tenant
identity from `BYPASS_TENANT_EMAIL` instead of the JWT email claim.

### Security note

`cf-edge-only` is **only safe** when origin access is pinned to
Cloudflare such that direct-to-origin requests cannot present a valid
`X-Caia-Edge-Token`. The current deployment achieves this via:

1. Cloudflare WAF Transform Rule (see operator follow-up below) that
   *unconditionally* sets `X-Caia-Edge-Token` to the value of the
   `EDGE_SHARED_SECRET` Cloudflare workers-secret, OVERWRITING any
   client-supplied value at the edge. A direct-origin attacker cannot
   forge the header without first compromising the shared secret.
2. The constant-time compare in `lib/auth/edge-bypass.ts` prevents
   timing side-channels on the secret check.

If you cannot guarantee #1 at the edge, leave `WIZARD_AUTH_MODE` at
the default `cloudflare` and pursue the WARP+Touch-ID flow (in-flight)
instead.

Operator must **never** set `WIZARD_AUTH_MODE=disabled` in production.

### Operator follow-up: Cloudflare WAF Transform Rule

Set up the Transform Rule that injects `X-Caia-Edge-Token` on every
request reaching the origin via the `dashboard.chiefaia.com` host:

1. Cloudflare dashboard → **Rules → Transform Rules → HTTP Request Header Modification**
2. Create rule:
   - **Rule name:** `inject-caia-edge-token-wizard`
   - **If incoming request matches:** `(http.host eq "dashboard.chiefaia.com")`
   - **Then... Modify request header:**
     - **Set static** name `X-Caia-Edge-Token` value `<value of EDGE_SHARED_SECRET>`
   - Deploy.
3. Verify with `curl -I https://dashboard.chiefaia.com --resolve dashboard.chiefaia.com:443:<CF-edge-ip>` from the operator's Mac — expect HTTP 200, not 307.

The WARP+Touch-ID task (in-flight) deprecates this entire mode — once
WARP is the auth substrate, drop `WIZARD_AUTH_MODE` back to
`cloudflare` and remove the Transform Rule.

### Env vars at a glance

| Var | Required when | Value |
| --- | --- | --- |
| `WIZARD_AUTH_MODE` | always | `cloudflare` \| `cf-edge-only` \| `disabled` |
| `BYPASS_ALLOWED_IPS` | mode=`cf-edge-only` | CSV of allowed `Cf-Connecting-Ip` values |
| `BYPASS_TENANT_EMAIL` | mode=`cf-edge-only` | Email used for tenant resolution in bypass path |
| `EDGE_SHARED_SECRET` (Secret) | mode=`cf-edge-only` | 32-char random hex; set via `openssl rand -hex 16` |

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
| `30-configmap.yaml`  | Non-secret runtime env (OTel, NATS coords, etc) |
| `40-secret-template.yaml` | TEMPLATE — real Secret lands via Infisical or `kubectl create secret` |

Image is published to `ghcr.io/prakashgbid/chiefaia-wizard` by
`.github/workflows/wizard-publish.yml` on every push to `develop`
touching `apps/wizard/**` or its workspace deps.

## First-time deploy

```bash
# 1. Materialise the real secret.
kubectl create secret generic chiefaia-wizard-secrets \
  --namespace chiefaia \
  --from-literal=GLOBAL_POSTGRES_URL='<...>' \
  --from-literal=INFISICAL_ADMIN_TOKEN='<...>' \
  --from-literal=NATS_NKEY_SEED='<...>' \
  --from-literal=CF_ACCESS_AUD='<application-aud>'

# 2. Apply the manifests:
kubectl apply -f infra/wizard/30-configmap.yaml
kubectl apply -f infra/wizard/10-deployment.yaml
kubectl apply -f infra/wizard/20-service.yaml

# 3. Wait for rollout.
kubectl rollout status deployment/chiefaia-wizard \
  --namespace chiefaia --timeout=120s

# 4. Smoke the route. Cloudflare Access returns 302 to the Access
#    login page — that's success at the routing layer.
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

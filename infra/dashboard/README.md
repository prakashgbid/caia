# chiefaia-dashboard — runtime manifests

Kubernetes manifests for the `chiefaia-dashboard` Deployment. Lives
behind the existing Istio VirtualService at
`infra/istio/chiefaia/21-virtualservice-dashboard.yaml`
(`dashboard.chiefaia.com`, Cloudflare Access gated).

## File map

| File | Purpose |
| --- | --- |
| `10-deployment.yaml` | Deployment + ServiceAccount + NetworkPolicy |
| `20-service.yaml`    | ClusterIP Service — replaces the placeholder Service |
| `30-configmap.yaml`  | Non-secret runtime env (OTel, NATS coords, etc) |
| `40-secret-template.yaml` | TEMPLATE — real Secret lands via Infisical or `kubectl create secret` |

Image is published to `ghcr.io/prakashgbid/chiefaia-dashboard` by
`.github/workflows/dashboard-publish.yml` on every push to `develop`
touching `apps/dashboard/**` or its workspace deps.

## First-time deploy

```bash
# 1. Materialise the real secret. Either:
#    (a) apply the InfisicalSecret CRD that syncs from Infisical, OR
#    (b) create the Secret directly:
kubectl create secret generic chiefaia-dashboard-secrets \
  --namespace chiefaia \
  --from-literal=GLOBAL_POSTGRES_URL='<...>' \
  --from-literal=INFISICAL_ADMIN_TOKEN='<...>' \
  --from-literal=NATS_NKEY_SEED='<...>'

# 2. Apply the manifests in order (the Service flip last, so the
#    placeholder keeps returning 503 until pods are Ready):
kubectl apply -f infra/dashboard/30-configmap.yaml
kubectl apply -f infra/dashboard/10-deployment.yaml
kubectl apply -f infra/dashboard/20-service.yaml

# 3. Wait for rollout. 1 replica + maxSurge=1 means this is fast.
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s

# 4. Smoke the route. Cloudflare Access returns 302 to the Access
#    login page — that's success at the routing layer.
curl -I https://dashboard.chiefaia.com
```

## Updating to a new image

The publish workflow tags every build as `ghcr.io/prakashgbid/chiefaia-dashboard:develop-<sha>`
AND moves the floating `:develop` tag. V1 rolls manually — pin to the
SHA tag for production:

```bash
kubectl -n chiefaia set image deployment/chiefaia-dashboard \
  dashboard=ghcr.io/prakashgbid/chiefaia-dashboard:develop-<sha>
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s
```

If the new image fails to come up Ready (probes flap), see the
**Rollback** section below.

## Rollback

The Deployment keeps the last 5 ReplicaSets (`revisionHistoryLimit: 5`),
so any of the last 5 rollouts can be reverted without an image push.

```bash
# List recent revisions
kubectl rollout history deployment/chiefaia-dashboard \
  --namespace chiefaia

# Roll back to the previous revision
kubectl rollout undo deployment/chiefaia-dashboard \
  --namespace chiefaia

# Roll back to a SPECIFIC revision
kubectl rollout undo deployment/chiefaia-dashboard \
  --namespace chiefaia \
  --to-revision=<N>

# Wait for the rollback to complete
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s
```

If the rollback also fails (e.g. the bad image fell off
revisionHistory), pin an explicit SHA tag and re-apply:

```bash
kubectl -n chiefaia set image deployment/chiefaia-dashboard \
  dashboard=ghcr.io/prakashgbid/chiefaia-dashboard:<known-good-sha>
kubectl rollout status deployment/chiefaia-dashboard \
  --namespace chiefaia --timeout=120s
```

If the cluster is wedged at the manifest layer (bad ConfigMap, bad
Secret), scale to zero, fix the manifest, then scale back up:

```bash
kubectl -n chiefaia scale deployment chiefaia-dashboard --replicas=0
# ... edit the offending file, kubectl apply -f ...
kubectl -n chiefaia scale deployment chiefaia-dashboard --replicas=1
```

## Verification checklist

After any rollout (initial deploy or image bump):

```bash
# 1. Deployment is Ready
kubectl get deploy chiefaia-dashboard -n chiefaia
# READY  UP-TO-DATE  AVAILABLE
# 1/1    1           1

# 2. Pod is Ready (both probes green)
kubectl get pods -n chiefaia -l app.kubernetes.io/name=chiefaia-dashboard

# 3. Route returns 302 to Cloudflare Access (not 503)
curl -I https://dashboard.chiefaia.com

# 4. Tracing wired — should see chiefaia-dashboard in Tempo
kubectl exec -n chiefaia deploy/tempo -- \
  curl -s 'http://localhost:3200/api/search?tags=service.name%3Dchiefaia-dashboard' \
  | head -50

# 5. (Optional) Inside the pod, confirm env wiring
kubectl exec -n chiefaia deploy/chiefaia-dashboard -- env | \
  grep -E '^(OTEL|NATS|NODE_ENV|PORT)' | sort
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Pod CrashLoopBackOff with "Cannot find module '@opentelemetry/sdk-node'" | Standalone bundle missed the dynamic import | Confirm Dockerfile copies `/repo/node_modules/@opentelemetry` into the runner stage |
| readinessProbe flapping with 503 | Postgres / Infisical / NATS unreachable | `kubectl logs` — readyz logs a `readyz.fail` JSON line listing the failing dep |
| Route returns 503 "no healthy upstream" | Service still selects 0 pods | Re-apply `20-service.yaml` AFTER the Deployment is Ready |
| Route returns 200/HTML instead of 302 | Cloudflare Access is bypassed | Confirm the VirtualService still references the CF Access Application UUID; do NOT remove the middleware |
| No traces in Tempo | Sampling, env, or network | Check `OTEL_EXPORTER_OTLP_ENDPOINT` in the pod env; confirm the NetworkPolicy allows port 4318 → tempo |

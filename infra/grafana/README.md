# Grafana — K3s manifests (Phase C2)

Grafana OSS deployment for the chiefaia trace surface. Pairs with the
Tempo install from PR #608 as the visualisation half of CAIA's
distributed trace spine.

- **Single replica.** SQLite backend + ReadWriteOnce PVC. The
  `Recreate` strategy keeps the model honest. Horizontal scale is a
  Phase C8+ concern (will require moving to Postgres).
- **Bare install.** No `kube-prometheus-stack`. No Loki. No Alertmanager.
  Only the Tempo data source is pre-provisioned; Prometheus comes in
  Phase C8.
- **Non-root.** Runs as uid 472 (Grafana's container default) with a
  read-only root filesystem. Persistent state in the 5 Gi PVC,
  ephemeral /tmp via emptyDir.
- **Behind Cloudflare Access.** Public hostname is
  `grafana.chiefaia.com`, gated by the `CAIA Grafana (operator-only)`
  Access app. Operator IP `69.118.44.175/32` bypasses Access at
  precedence 1. Same pattern as `ops.chiefaia.com`.
- **$0 net-new services.** Grafana OSS is the only addition.

## Files

| File                       | Purpose                                                 |
| -------------------------- | ------------------------------------------------------- |
| `10-deployment.yaml`       | Grafana 10.4.3 OSS Deployment, single replica           |
| `20-service.yaml`          | ClusterIP Service, port 80 → 3000                       |
| `30-configmap.yaml`        | Tempo datasource + dashboard provider + 3 dashboards    |
| `40-secret-template.yaml`  | Admin password Secret template (do **NOT** commit live) |
| `50-pvc.yaml`              | 5 Gi PVC for SQLite + plugins                           |
| `60-istio-vs.yaml`         | VirtualService `grafana.chiefaia.com` → Service:80      |
| `dashboards/*.json`        | Source-of-truth dashboard JSON                          |
| `scripts/grafana-configmap-gen.py` | Regenerates `30-configmap.yaml` from `dashboards/` |
| `scripts/grafana-verify.py`        | Post-deploy verification (datasource + dashboards) |

## Apply

```bash
# 1. Bootstrap the admin password Secret (out-of-band, never commit).
ADMIN_PW=$(openssl rand -base64 24 | tr -d '=+/' | head -c 32)
kubectl -n chiefaia create secret generic grafana-admin \
  --from-literal=admin-password="$ADMIN_PW"
echo "Save in Infisical: chiefaia/grafana/admin-password = $ADMIN_PW"

# 2. Apply manifests in order.
kubectl -n chiefaia apply -f infra/grafana/50-pvc.yaml
kubectl -n chiefaia apply -f infra/grafana/30-configmap.yaml
kubectl -n chiefaia apply -f infra/grafana/20-service.yaml
kubectl -n chiefaia apply -f infra/grafana/10-deployment.yaml
kubectl -n chiefaia apply -f infra/grafana/60-istio-vs.yaml

# 3. Wait for ready.
kubectl -n chiefaia rollout status deploy/grafana
```

## Verify

In-cluster (no DNS, no Access):

```bash
# Health check
kubectl -n chiefaia run grafana-probe --image=curlimages/curl \
  --restart=Never --rm -i --tty -- \
  curl -sS http://grafana.chiefaia.svc.cluster.local/api/health

# Expected: {"database":"ok","version":"10.4.3","commit":"..."}
```

Datasource + dashboards:

```bash
# Run from anywhere with cluster access — uses kubectl exec into the
# Grafana pod so admin credentials never leave the cluster.
python3 infra/grafana/scripts/grafana-verify.py
```

That script:

1. Verifies `/api/health` returns `database: ok`.
2. Hits `/api/datasources/uid/tempo/health` — expects `OK`.
3. Lists `/api/search?type=dash-db` — expects ≥ 3 dashboards
   (`caia-traces`, `caia-wizard-flow`, `caia-claude-calls`).

Public (after DNS + tunnel ingress + Access are wired):

```bash
# From an unprivileged IP (e.g. mobile hotspot) — should redirect
# to the Access login page.
curl -I https://grafana.chiefaia.com
# HTTP/2 302
# location: https://stolution.cloudflareaccess.com/cdn-cgi/access/login/...

# From the operator IP (69.118.44.175) — bypass policy returns the
# Grafana login page directly.
curl -I https://grafana.chiefaia.com
# HTTP/2 200
```

## Dashboards

Source JSON lives in `dashboards/`. To edit:

1. Modify the JSON file in `infra/grafana/dashboards/`.
2. `python3 infra/grafana/scripts/grafana-configmap-gen.py`
3. `kubectl -n chiefaia apply -f infra/grafana/30-configmap.yaml`
4. `kubectl -n chiefaia rollout restart deploy/grafana`

| Dashboard            | UID                  | Folder | Purpose                                                        |
| -------------------- | -------------------- | ------ | -------------------------------------------------------------- |
| CAIA Traces          | `caia-traces`        | CAIA   | P95 latency / error rate / top slow spans per service.name     |
| CAIA Wizard Flow     | `caia-wizard-flow`   | CAIA   | Trace count + avg duration per `wizard.*` step                 |
| CAIA Claude Calls    | `caia-claude-calls`  | CAIA   | `claude.spawn` rate / P95 / error rate, broken down by model   |

Panels backed by TraceQL metrics (`rate()`, `quantile_over_time(...)`)
require Tempo's local-blocks processor. The PR #608 Tempo config has
the metrics_generator stanza already; some panels may take a few
minutes to fill in after Grafana boots while the ingester accumulates
local blocks.

## Cloudflare

DNS, tunnel ingress rule, and Access policy are managed via the
`stolution-infra/cloudflare-api` secret:

```
grafana.chiefaia.com  CNAME  3cf7eece-1e16-4dbe-8460-a127b8e9d238.cfargotunnel.com  (proxied)
```

Tunnel ingress (remote-managed, set via the CF tunnel configuration
API): `grafana.chiefaia.com` → `http://localhost:31346` (Istio
ingressgateway NodePort, same pattern as the other chiefaia
subdomains).

Access app: `CAIA Grafana (operator-only)`, self-hosted, domain
`grafana.chiefaia.com`. Policies (lower precedence wins):

| Precedence | Decision | Name                                | Include                                |
| ---------- | -------- | ----------------------------------- | -------------------------------------- |
| 1          | bypass   | Bypass operator Mac IP              | ip 69.118.44.175/32                    |
| 2          | allow    | WARP enrolled + Operator (preferred)| email prakash.stolution@gmail.com (+ posture)  |
| 3          | allow    | Email fallback (OneTimePin)         | email prakash.stolution@gmail.com      |

## Tear down

```bash
kubectl -n chiefaia delete -f infra/grafana/60-istio-vs.yaml
kubectl -n chiefaia delete -f infra/grafana/10-deployment.yaml
kubectl -n chiefaia delete -f infra/grafana/20-service.yaml
kubectl -n chiefaia delete -f infra/grafana/30-configmap.yaml
kubectl -n chiefaia delete -f infra/grafana/50-pvc.yaml   # keeps the data otherwise
kubectl -n chiefaia delete secret grafana-admin
```

# Prometheus + Alertmanager — K3s manifests (Phase C8)

Bare Prometheus 2.x + Alertmanager 0.27.x install for the chiefaia
spine. Pairs with Grafana (PR #643/#644) — Grafana gains the
Prometheus + Alertmanager data sources through its existing
ConfigMap update. Pairs with Tempo (PR #608) — Tempo's metrics
generator is reconfigured to remote_write span-derived metrics into
this Prometheus, which becomes the source of truth for SLO recording
rules and burn-rate alerts.

- **Single replica** of each binary. Local TSDB / nflog; no HA. HA
  is a Phase D concern (will require Thanos or a sidecar pattern).
- **Bare install.** No `kube-prometheus-stack`. No CRDs. Two binaries,
  one ConfigMap each, one PVC for Prometheus, an emptyDir for AM.
- **Non-root.** Both run as uid 65534 (`nobody`) with read-only root
  filesystem and TSDB-only writes.
- **Behind Cloudflare Access.** `prom.chiefaia.com` is operator-only,
  same pattern as `grafana.chiefaia.com`. Operator IP bypass at
  precedence 1.
- **$0 net-new services.** Prometheus + Alertmanager OSS; no managed
  service additions.

## Files

| File                                  | Purpose                                                  |
| ------------------------------------- | -------------------------------------------------------- |
| `10-deployment-prometheus.yaml`       | Prometheus 2.54.1 OSS Deployment, single replica         |
| `20-service-prometheus.yaml`          | ClusterIP Service, port 9090                             |
| `30-deployment-alertmanager.yaml`     | Alertmanager 0.27.0, single replica                      |
| `40-service-alertmanager.yaml`        | ClusterIP Service, port 9093                             |
| `50-configmap-prometheus.yaml`        | Scrape config + recording rules + burn-rate alert rules  |
| `60-configmap-alertmanager.yaml`      | Route config: single webhook receiver → operator INBOX   |
| `65-deployment-webhook-receiver.yaml` | INBOX webhook receiver Deployment + Service + PVC        |
| `70-pvc-prometheus.yaml`              | 10 Gi PVC for the TSDB                                   |
| `80-istio-vs-prometheus.yaml`         | VirtualService `prom.chiefaia.com` → Service:9090        |
| `webhook-receiver/main.py`            | Stdlib-only Python receiver — alert webhook → INBOX file |
| `webhook-receiver/Dockerfile`         | `python:3.12-alpine` base; non-root; ~15 MB compressed   |
| `scripts/burn-rate-scenarios.py`      | 3 verification scenarios (latency, error, recovery)      |

## Apply

```bash
# 1. (One-time) Regenerate the webhook receiver ConfigMap from
#    source. V1 mounts main.py from a ConfigMap into a stock
#    python:3.12-alpine pod — no image build/push needed. When you
#    edit webhook-receiver/main.py, regenerate then re-apply:
python3 infra/prometheus/scripts/regen-receiver-cm.py

# 2. Apply manifests in order.
kubectl -n chiefaia apply -f infra/prometheus/70-pvc-prometheus.yaml
kubectl -n chiefaia apply -f infra/prometheus/50-configmap-prometheus.yaml
kubectl -n chiefaia apply -f infra/prometheus/60-configmap-alertmanager.yaml
kubectl -n chiefaia apply -f infra/prometheus/20-service-prometheus.yaml
kubectl -n chiefaia apply -f infra/prometheus/40-service-alertmanager.yaml
kubectl -n chiefaia apply -f infra/prometheus/10-deployment-prometheus.yaml
kubectl -n chiefaia apply -f infra/prometheus/30-deployment-alertmanager.yaml
kubectl -n chiefaia apply -f infra/prometheus/63-configmap-webhook-receiver-code.yaml
kubectl -n chiefaia apply -f infra/prometheus/65-deployment-webhook-receiver.yaml
kubectl -n chiefaia apply -f infra/prometheus/80-istio-vs-prometheus.yaml

# 3. Reload Tempo so the new metrics_generator processor picks up.
kubectl -n chiefaia apply -f infra/tempo/10-configmap.yaml
kubectl -n chiefaia rollout restart deploy/tempo

# 4. Reload Grafana so it picks up the Prometheus + Alertmanager
#    data sources and the SLO compliance dashboard.
kubectl -n chiefaia apply -f infra/grafana/30-configmap.yaml
kubectl -n chiefaia apply -f infra/grafana/10-deployment.yaml
kubectl -n chiefaia rollout restart deploy/grafana

# 5. Wait for ready.
kubectl -n chiefaia rollout status deploy/prometheus
kubectl -n chiefaia rollout status deploy/alertmanager
kubectl -n chiefaia rollout status deploy/alertmanager-webhook-receiver
```

## Verify

In-cluster smoke tests (no DNS, no Access):

```bash
# Prometheus /-/ready
kubectl -n chiefaia run prom-probe --image=curlimages/curl --restart=Never --rm -i --tty -- \
  curl -sS http://prometheus.chiefaia.svc.cluster.local:9090/-/ready

# Alertmanager /-/ready
kubectl -n chiefaia run am-probe --image=curlimages/curl --restart=Never --rm -i --tty -- \
  curl -sS http://alertmanager.chiefaia.svc.cluster.local:9093/-/ready

# Webhook receiver /healthz
kubectl -n chiefaia run rec-probe --image=curlimages/curl --restart=Never --rm -i --tty -- \
  curl -sS http://alertmanager-webhook-receiver.chiefaia.svc.cluster.local:8080/healthz
```

Recording rules — verify they are computing:

```bash
kubectl -n chiefaia exec deploy/prometheus -- \
  promtool query instant http://localhost:9090 \
  'wizard:step_render_p95:5m or wizard:step_render_p95:1h or wizard:step_render_p95:24h'

kubectl -n chiefaia exec deploy/prometheus -- \
  promtool query instant http://localhost:9090 \
  'http:availability_ratio_5m'

# A query that should resolve as soon as Tempo is sending data and
# the rules have evaluated for at least one cycle (~30s after apply).
```

INBOX contents:

```bash
# View accumulated alert entries.
kubectl -n chiefaia exec deploy/alertmanager-webhook-receiver -- cat /inbox/INBOX.md

# Copy out for the operator memory bank.
kubectl -n chiefaia cp \
  $(kubectl -n chiefaia get pod -l app.kubernetes.io/name=alertmanager-webhook-receiver \
       -o jsonpath='{.items[0].metadata.name}'):/inbox/INBOX.md \
  ~/Documents/projects/agent-memory/INBOX.md.fresh
```

## Burn-rate verification scenarios

`scripts/burn-rate-scenarios.py` drives 3 synthetic scenarios:

```bash
python3 infra/prometheus/scripts/burn-rate-scenarios.py latency
python3 infra/prometheus/scripts/burn-rate-scenarios.py error
python3 infra/prometheus/scripts/burn-rate-scenarios.py recovery
```

What each does:

- **latency** — launches a generator pod that emits 60 wizard step
  spans/minute with 5-second durations (10× the 500 ms SLO). After
  ~10 minutes, asserts `WizardStepRenderP95BurnRateCritical` is
  firing and that the INBOX contains a `[CRITICAL]` entry.
- **error** — same shape, but with normal (200ms) durations and 1%
  of spans marked `STATUS_CODE_ERROR` (10× the 0.1% SLO). Asserts
  `WizardStepErrorRatioBurnRateWarning` fires and lands in INBOX.
- **recovery** — deletes the generator pods. After ~6 minutes
  (Alertmanager `resolve_timeout: 5m` + grouping), asserts a
  `[RESOLVED:CRITICAL]` entry lands in the INBOX.

## Runbook — burn-rate alerts

### `WizardStepRenderP95BurnRateCritical` / `WizardStepRenderP95BurnRateWarning`

Wizard step render P95 latency has exceeded the 500ms SLO budget at
a rate that will exhaust the monthly error budget faster than 30
days will replenish it.

Investigation steps:

1. Open the `CAIA SLO Compliance` Grafana dashboard. The
   "Wizard step render P95 — burn-rate windows" panel shows the
   1h vs 24h windows side-by-side. Confirm both windows breach.
2. Pivot to `CAIA Wizard Flow` to see per-step breakdown. Which
   `wizard.step.*` span is regressing?
3. Pivot to `CAIA Traces` and filter by `resource.service.name =
   chiefaia-wizard` to find a representative slow trace. Inspect
   the span tree — is the regression in the Next.js handler, in
   the @chiefaia/claude-spawner call, or in a downstream service?
4. If the regression is in Claude calls, check
   `WizardClaudeCallP95BurnRateCritical` next.

Likely causes: pod resource starvation, a deploy that changed the
hot path, upstream Claude API slow-down.

### `WizardClaudeCallP95BurnRateCritical` / `WizardClaudeCallP95BurnRateWarning`

`claude.spawn` span P95 is exceeding the 30s ceiling. Sub-symptoms
of an upstream Claude problem or a wizard-side prompt regression.

Investigation steps:

1. Inspect Anthropic status (https://status.anthropic.com).
2. Open `CAIA Claude Calls` dashboard — the per-model panel will
   show whether the regression is concentrated in one model.
3. Check recent wizard deploys for prompt size growth or
   tool-loop changes.

### `WizardStepErrorRatioBurnRateCritical` / `WizardStepErrorRatioBurnRateWarning`

Wizard step error ratio is above 0.1%/month at a rate that consumes
the monthly budget too fast.

Investigation steps:

1. Open `CAIA Wizard Flow` — the per-step error panel localises
   which step is failing.
2. Cross-reference with the `chiefaia-wizard` deploy log; recent
   pushes are the highest-likelihood cause.
3. Tail receiver INBOX for related alerts (HTTP availability for
   the same service often co-fires).

### `HttpAvailabilityBurnRateCritical` / `HttpAvailabilityBurnRateWarning`

Per-service HTTP availability (% of non-5xx server spans) is below
99.9% at a pageable rate. The firing alert's `{{ $labels.service }}`
identifies which service.

Investigation steps:

1. Check `kubectl -n chiefaia get pods` for crash-loops or
   not-ready pods.
2. Check the Istio sidecar logs for upstream connection failures.
3. Open `CAIA SLO Compliance` and confirm 1h + 24h burn rates.

## Operator-only access

`prom.chiefaia.com` Access app, self-hosted, same SSO group as Grafana.

| Precedence | Decision | Name                                | Selector                                |
| ---------- | -------- | ----------------------------------- | --------------------------------------- |
| 1          | bypass   | Bypass operator Mac IP              | ip 69.118.44.175/32                     |
| 2          | allow    | Anthropic group (operator-only SSO) | group `caia-operators`                  |

## What this PR does NOT do

- **No paging integration.** Alertmanager fires to a webhook that
  writes the INBOX file. PagerDuty / Twilio / Opsgenie is Phase D.
- **No nats-exporter.** The NATS scrape job is configured but the
  exporter sidecar that provides the `/metrics` endpoint is a
  follow-up. The target shows `down` until then.
- **No wizard /metrics endpoint.** The recording rules currently
  source from Tempo span-derived metrics (`traces_spanmetrics_*`).
  When `@chiefaia/metrics` instrumentation lands on the wizard the
  rules can dual-source.
- **No HA-Prometheus or HA-Alertmanager.** Single replicas; the
  gossip mesh is explicitly disabled via `--cluster.listen-address=`.

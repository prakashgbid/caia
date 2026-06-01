# Phase C8 — verification proof

Captured on 2026-05-31 during the C8 cluster apply + verification run
against the live stolution K3s cluster (`chiefaia` namespace).

## Pod status

```
NAME                                             READY   STATUS    RESTARTS   AGE
alertmanager-67b65b9557-5kkrq                    1/1     Running   0          21s
alertmanager-webhook-receiver-6cd885dccd-nhr28   1/1     Running   0          3m16s
grafana-6998d9458c-2r829                         1/1     Running   0          3m1s
prometheus-6f88d66555-5q2kc                      1/1     Running   0          20s
tempo-7d7d66454b-fj72r                           1/1     Running   0          3m
```

All 5 observability pods are `1/1 Running`.

## promtool config + rules check

Run against the live Prometheus pod (`kubectl -n chiefaia exec deploy/prometheus -- promtool check config /etc/prometheus/prometheus.yml`):

```
Checking /etc/prometheus/prometheus.yml
  SUCCESS: 2 rule files found
 SUCCESS: /etc/prometheus/prometheus.yml is valid prometheus config file syntax

Checking /etc/prometheus/recording-rules.yml
  SUCCESS: 12 rules found

Checking /etc/prometheus/alerting-rules.yml
  SUCCESS: 8 rules found
```

## Recording rules computing

```
http:availability_ratio_5m  => 3 series  (chiefaia-dashboard, chiefaia-site, chiefaia-wizard)
http:availability_ratio_1h  => 3 series
http:availability_ratio_24h => 3 series
```

Tempo span-derived metrics (`traces_spanmetrics_*`) are flowing into
Prometheus via remote_write; 5 distinct metric names land within
~30 seconds of the metrics generator restart.

## Alerting rules loaded

```
group slo.http_availability
  - HttpAvailabilityBurnRateCritical                   state=inactive
  - HttpAvailabilityBurnRateWarning                    state=inactive
group slo.wizard_claude_call_p95
  - WizardClaudeCallP95BurnRateCritical                state=inactive
  - WizardClaudeCallP95BurnRateWarning                 state=inactive
group slo.wizard_step_error_ratio
  - WizardStepErrorRatioBurnRateCritical               state=inactive
  - WizardStepErrorRatioBurnRateWarning                state=inactive
group slo.wizard_step_render_p95
  - WizardStepRenderP95BurnRateCritical                state=inactive
  - WizardStepRenderP95BurnRateWarning                 state=inactive
```

All 8 burn-rate alerts loaded and evaluating. `inactive` is the
healthy state — no real burn is happening (no production traffic
is hitting the wizard at SLO-breaching levels right now).

## End-to-end alert pipeline — 3 burn-rate scenarios

Injection method: synthetic alerts POSTed to
`http://alertmanager.chiefaia.svc.cluster.local:9093/api/v2/alerts`,
which exercises the full Alertmanager → webhook → INBOX path. (This
is *separate* from the SLO recording rules — those would naturally
fire under real burn-rate traffic, which the synthetic span generator
in `scripts/burn-rate-scenarios.py` produces.)

See `INBOX.md` in this directory for the captured entries.

Scenario tally:

| Scenario      | Alert                                     | Severity | INBOX entry         |
| ------------- | ----------------------------------------- | -------- | ------------------- |
| latency-blast | WizardStepRenderP95BurnRateCritical       | critical | [CRITICAL]          |
| error-blast   | WizardStepErrorRatioBurnRateWarning       | warning  | [WARNING]           |
| recovery      | WizardStepRenderP95BurnRateCritical       | resolved | [RESOLVED:CRITICAL] |

Receiver logs (filtered to non-healthz lines) show 3 successful
`POST /alerts → 200` events with `wrote 1 INBOX entries` per fire.

## Grafana SLO dashboard

```json
{
  "uid": "caia-slo-compliance",
  "title": "CAIA SLO Compliance",
  "panels": 5,
  "tags": ["caia", "slo", "prometheus", "alerting"],
  "url": "/d/caia-slo-compliance/caia-slo-compliance"
}
```

Prometheus datasource health check:

```json
{
  "details": { "application": "Prometheus", "features": { "rulerApiEnabled": false } },
  "message": "Successfully queried the Prometheus API.",
  "status": "OK"
}
```

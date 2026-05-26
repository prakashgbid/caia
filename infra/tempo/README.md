# Tempo — K3s manifests

Grafana Tempo deployment for CAIA's distributed trace spine. Per the
operator decision dated 2026-05-25:

- **In-cluster only.** No Ingress. Verification is via `kubectl run`
  + `curl` against the in-cluster service DNS.
- **No Grafana.** Deferred to a follow-up. Trace verification uses
  Tempo's HTTP query API directly.
- **$0 new services.** Tempo is the only addition; runs on existing
  K3s nodes alongside `chiefaia-api`, `chiefaia-web`, NATS.

## Apply

```bash
kubectl -n chiefaia apply -f infra/tempo/10-configmap.yaml
kubectl -n chiefaia apply -f infra/tempo/20-service.yaml
kubectl -n chiefaia apply -f infra/tempo/30-deployment.yaml

# Wait for ready.
kubectl -n chiefaia rollout status deploy/tempo
```

## Verify

Producer (fire a synthetic OTLP-HTTP span into Tempo):

```bash
TRACE_ID=$(openssl rand -hex 16)
SPAN_ID=$(openssl rand -hex 8)
TS_NANO=$(($(date +%s) * 1000000000))

kubectl -n chiefaia run tracer-probe --image=curlimages/curl --restart=Never --rm -i --tty -- \
  curl -sS -X POST http://tempo.chiefaia.svc.cluster.local:4318/v1/traces \
    -H 'Content-Type: application/json' \
    -d "{\"resourceSpans\":[{\"resource\":{\"attributes\":[{\"key\":\"service.name\",\"value\":{\"stringValue\":\"smoke-test\"}}]},\"scopeSpans\":[{\"spans\":[{\"traceId\":\"$TRACE_ID\",\"spanId\":\"$SPAN_ID\",\"name\":\"smoke\",\"kind\":1,\"startTimeUnixNano\":\"$TS_NANO\",\"endTimeUnixNano\":\"$TS_NANO\"}]}]}]}"
```

Consumer (query the trace back):

```bash
kubectl -n chiefaia run trace-query --image=curlimages/curl --restart=Never --rm -i --tty -- \
  curl -sS "http://tempo.chiefaia.svc.cluster.local:3200/api/traces/$TRACE_ID"
```

The query API returns a 404 until the trace has flushed from the
ingester to a block (≤ 10 s with the V1 config). On success, the JSON
contains a `batches` array with the resourceSpans we just sent.

## Wire an app

Apps that import `@chiefaia/tracing` and call `initTracing()` will
emit OTLP-HTTP at `http://tempo.chiefaia.svc.cluster.local:4318/v1/traces`
by default. Override per environment via `OTEL_EXPORTER_OTLP_ENDPOINT`.

## Grafana (future enhancement, deferred V1)

Once Grafana lands in the cluster (separate PR), wire Tempo as a data
source via this URL:

```
http://tempo.chiefaia.svc.cluster.local:3200
```

…and import the dashboard JSON at `infra/grafana/dashboards/caia-traces.json`.
That dashboard is a placeholder today — once Grafana is real, we'll
fill in panels for p95 latency / service, top-10 slowest spans, error
rate / service.

## Tear down

```bash
kubectl -n chiefaia delete -f infra/tempo/30-deployment.yaml
kubectl -n chiefaia delete -f infra/tempo/20-service.yaml
kubectl -n chiefaia delete -f infra/tempo/10-configmap.yaml
```

# caia/services/observability/dashboards

Source of truth for the CAIA Grafana dashboard JSON.

## Contents

- **`build_dashboard.py`** — Generator script (Python 3). Emits `caia-autonomous-system.json` (the Grafana 11 dashboard model for *CAIA Autonomous System — 24h Walkaway View*, dashboard uid `caia-walkaway`). Runs against Prometheus datasource uid `caia-prom` and Loki datasource uid `P8E80F9AEF21F6940`.
- **`caia-autonomous-system.json`** — Last-generated dashboard JSON. Imported into the operator's Grafana instance at `monitor.stolution.com/grafana`.

## Provenance

Migrated from `~/Documents/projects/reports-from-m1/observability-artifacts/` on 2026-05-15 by phase B5 of integration-remediation-b. The dashboard JSON is load-bearing — it is referenced from `~/Documents/projects/reports-from-m1/observability-queries.md` and is the operator's primary view of the 24h walk-away pipeline. Original directory predates this consolidation; companion query catalog (`observability-queries.md`) is being left in place pending a separate docs sweep.

## Regenerate

```bash
cd ~/Documents/projects/caia/services/observability/dashboards
python3 build_dashboard.py > caia-autonomous-system.json
# Import in Grafana: Dashboards → New → Import → paste JSON
```

The script writes deterministic output — diff `caia-autonomous-system.json` against the prior version on every PR that edits the generator.

## Why not in `caia/packages/`?

Per plan invariant AR-3 (services/ not packages/, integration_remediation_plan_2026-05-14.md). The dashboard is a runtime/operator artifact, not a publishable npm package.

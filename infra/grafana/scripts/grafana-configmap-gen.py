#!/usr/bin/env python3
"""Regenerate infra/grafana/30-configmap.yaml from the dashboards/ directory.

Source of truth for each dashboard is the JSON file in
`infra/grafana/dashboards/`. Editing a dashboard requires:

    1. Edit the JSON in infra/grafana/dashboards/<dashboard>.json
    2. Run this script from the repo root.
    3. kubectl -n chiefaia apply -f infra/grafana/30-configmap.yaml
    4. kubectl -n chiefaia rollout restart deploy/grafana

The Grafana sidecar provisioning also picks up ConfigMap changes
within ~30s without a pod restart, but the restart is the
documented path because it guarantees the new state is loaded.

Phase C8 update: adds the Prometheus datasource (UID `prometheus`)
and the `caia-slo-compliance.json` dashboard.
"""
import json
import os
import sys

ROOT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
DASHBOARDS_DIR = os.path.join(ROOT_DIR, "dashboards")
OUTPUT = os.path.join(ROOT_DIR, "30-configmap.yaml")

# Ordered so the generated file is deterministic.
DASHBOARDS = [
    "caia-traces.json",
    "caia-wizard-flow.json",
    "caia-claude-calls.json",
    "caia-slo-compliance.json",
]

HEADER = """# Grafana provisioning — datasources, dashboard provider, dashboards JSON.
#
# Phase C2 deliverable (Tempo + 3 trace dashboards) extended in Phase
# C8 with the Prometheus datasource and the SLO compliance dashboard.
# Single ConfigMap holds:
#   - datasources.yaml            → Tempo (uid: tempo) + Prometheus (uid: prometheus)
#   - dashboards.yaml             → file provider pointing at
#                                    /var/lib/grafana/dashboards
#   - caia-traces.json            → service-wide trace health
#   - caia-wizard-flow.json       → wizard step breakdown
#   - caia-claude-calls.json      → @chiefaia/claude-spawner panel
#   - caia-slo-compliance.json    → SLO burn-rate + error budget + firing alerts
#
# The Deployment mounts each key at the path Grafana expects via
# explicit `items:` in 10-deployment.yaml. Editing any dashboard
# JSON in `dashboards/` requires regenerating this file —
# `scripts/grafana-configmap-gen.py` rebuilds it from the source
# JSON in that directory.
#
# Source of truth is the JSON in infra/grafana/dashboards/.
apiVersion: v1
kind: ConfigMap
metadata:
  name: grafana-config
  namespace: chiefaia
  labels:
    app.kubernetes.io/name: grafana
    app.kubernetes.io/part-of: caia-observability
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: Tempo
        type: tempo
        uid: tempo
        access: proxy
        url: http://tempo.chiefaia.svc.cluster.local:3200
        isDefault: true
        editable: false
        jsonData:
          httpMethod: GET
          serviceMap:
            datasourceUid: tempo
          search:
            hide: false
          nodeGraph:
            enabled: true
          tracesToLogs:
            datasourceUid: ""
      - name: Prometheus
        type: prometheus
        uid: prometheus
        access: proxy
        url: http://prometheus.chiefaia.svc.cluster.local:9090
        isDefault: false
        editable: false
        jsonData:
          httpMethod: GET
          timeInterval: 30s
          manageAlerts: false
          alertmanagerUid: alertmanager
      - name: Alertmanager
        type: alertmanager
        uid: alertmanager
        access: proxy
        url: http://alertmanager.chiefaia.svc.cluster.local:9093
        isDefault: false
        editable: false
        jsonData:
          implementation: prometheus
          handleGrafanaManagedAlerts: false
  dashboards.yaml: |
    apiVersion: 1
    providers:
      - name: caia
        orgId: 1
        folder: CAIA
        folderUid: caia
        type: file
        disableDeletion: true
        editable: false
        allowUiUpdates: false
        updateIntervalSeconds: 30
        options:
          path: /var/lib/grafana/dashboards
          foldersFromFilesStructure: false
"""


def indent(text: str, n: int) -> str:
    pad = " " * n
    return "".join(pad + line if line.strip() else line for line in text.splitlines(keepends=True))


def main() -> int:
    body = HEADER
    for fname in DASHBOARDS:
        path = os.path.join(DASHBOARDS_DIR, fname)
        with open(path) as f:
            content = f.read()
        # Sanity: must be valid JSON
        json.loads(content)
        body += f"  {fname}: |\n"
        body += indent(content, 4)
        if not body.endswith("\n"):
            body += "\n"
    with open(OUTPUT, "w") as f:
        f.write(body)
    print(f"Wrote {len(body)} chars to {OUTPUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

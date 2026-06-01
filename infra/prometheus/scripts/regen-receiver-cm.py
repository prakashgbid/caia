#!/usr/bin/env python3
"""Regenerate infra/prometheus/63-configmap-webhook-receiver-code.yaml.

Source of truth is webhook-receiver/main.py.  Run after editing
the receiver code:

    python3 infra/prometheus/scripts/regen-receiver-cm.py
    kubectl -n chiefaia apply -f infra/prometheus/63-configmap-webhook-receiver-code.yaml
    kubectl -n chiefaia rollout restart deploy/alertmanager-webhook-receiver
"""
from __future__ import annotations

import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "webhook-receiver" / "main.py"
OUT = ROOT / "63-configmap-webhook-receiver-code.yaml"

HEADER = """# alertmanager-webhook-receiver source — mounted into a python:3.12-alpine
# pod that runs `python /code/main.py`. No image build needed; the
# stdlib does everything (http.server, json).
#
# Edit infra/prometheus/webhook-receiver/main.py and regenerate this
# ConfigMap with `python3 infra/prometheus/scripts/regen-receiver-cm.py`.
apiVersion: v1
kind: ConfigMap
metadata:
  name: alertmanager-webhook-receiver-code
  namespace: chiefaia
  labels:
    app.kubernetes.io/name: alertmanager-webhook-receiver
    app.kubernetes.io/part-of: caia-observability
data:
  main.py: |
"""


def main() -> int:
    script = SRC.read_text()
    body = HEADER
    for line in script.splitlines():
        body += "    " + line + "\n"
    OUT.write_text(body)
    print(f"wrote {OUT} ({len(body)} chars)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

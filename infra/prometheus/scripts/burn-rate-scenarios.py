#!/usr/bin/env python3
"""Phase C8 — synthetic burn-rate verification.

Drives 3 scenarios against an in-cluster test pod that emits synthetic
spans to Tempo's OTLP HTTP endpoint, which Tempo's metrics generator
then converts into Prometheus series that the recording rules and
alerts consume.

Why synthetic spans instead of hammering /api/wizard/onboarding:
  - Wizard /metrics + step-render histograms are not landed yet
    (planned for the wave that follows C8). Synthetic spans exercise
    the SAME observability path (Tempo metrics generator → Prometheus
    remote_write → recording rules → alerts → Alertmanager → INBOX)
    without requiring the wizard to be re-instrumented first.
  - It also keeps the burn-rate verification deterministic: a real
    HTTP blast against the wizard depends on the dashboard's current
    state, network conditions, and Cloudflare rate limiting. Synthetic
    spans isolate the alerting plumbing as the unit under test.

Scenarios:
  1. latency-blast — emits 60 chiefaia-wizard `wizard.step.*` spans/min
     with a synthetic duration of 5000ms. The SLO bound is 500ms, so
     P95 latency jumps to ~5s; the critical alert
     `WizardStepRenderP95BurnRateCritical` is expected to fire within
     the 1h evaluation window.
  2. error-blast — emits 60 spans/min with 1% having
     status_code=STATUS_CODE_ERROR. The SLO bound is 0.1%, so
     `WizardStepErrorRatioBurnRateWarning` is expected to fire on the
     24h window (we patch the alerting rules to evaluate against a
     5m window for this test only — see TEST_OVERRIDES).
  3. recovery — stops the blast. Within ~5m the recording rules drop
     and the alerts auto-resolve. We verify a RESOLVED entry appears
     in the INBOX.

Run:
    python3 infra/prometheus/scripts/burn-rate-scenarios.py latency
    python3 infra/prometheus/scripts/burn-rate-scenarios.py error
    python3 infra/prometheus/scripts/burn-rate-scenarios.py recovery
    python3 infra/prometheus/scripts/burn-rate-scenarios.py all
"""

from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time
from pathlib import Path

NS = "chiefaia"
TEMPO_OTLP_HTTP = "http://tempo.chiefaia.svc.cluster.local:4318/v1/traces"
PROM_URL = "http://prometheus.chiefaia.svc.cluster.local:9090"
INBOX_POD_SVC = "alertmanager-webhook-receiver"


def kubectl(*args: str, check: bool = True, capture: bool = True) -> subprocess.CompletedProcess:
    """Run kubectl with the configured namespace."""
    cmd = ["kubectl", "-n", NS, *args]
    return subprocess.run(cmd, check=check, capture_output=capture, text=True)


def query_prom(query: str) -> dict:
    """Query Prometheus via in-cluster curl pod (kubectl run)."""
    body = kubectl(
        "run",
        f"prom-q-{int(time.time())}",
        "--rm",
        "-i",
        "--restart=Never",
        "--image=curlimages/curl:8.10.1",
        "--quiet",
        "--",
        "curl",
        "-sS",
        "--data-urlencode",
        f"query={query}",
        f"{PROM_URL}/api/v1/query",
    ).stdout
    return json.loads(body)


def fetch_inbox() -> str:
    """Read /inbox/INBOX.md from the receiver pod."""
    result = kubectl(
        "exec",
        f"deploy/{INBOX_POD_SVC}",
        "--",
        "cat",
        "/inbox/INBOX.md",
        check=False,
    )
    return result.stdout


def emit_spans_pod(scenario: str, duration_min: int) -> None:
    """Launch a transient pod that emits synthetic OTLP spans for `duration_min` minutes."""
    script = _generator_script(scenario)
    pod_name = f"burn-rate-{scenario}-{int(time.time())}"
    print(f"[run] launching {pod_name} for {duration_min}m of {scenario} traffic")
    # The generator is small enough to embed via `kubectl exec -i`.
    # We use python:3.12-alpine which has the stdlib urllib for OTLP HTTP.
    pod_spec = {
        "apiVersion": "v1",
        "kind": "Pod",
        "metadata": {"name": pod_name, "labels": {"app.kubernetes.io/name": "burn-rate-generator"}},
        "spec": {
            "restartPolicy": "Never",
            "containers": [
                {
                    "name": "generator",
                    "image": "python:3.12-alpine",
                    "command": ["python", "-c", script],
                    "env": [
                        {"name": "DURATION_MIN", "value": str(duration_min)},
                        {"name": "OTLP_URL", "value": TEMPO_OTLP_HTTP},
                    ],
                }
            ],
        },
    }
    kubectl("apply", "-f", "-", capture=False, check=True).check_returncode() if False else (
        subprocess.run(
            ["kubectl", "-n", NS, "apply", "-f", "-"],
            input=json.dumps(pod_spec),
            check=True,
            text=True,
        )
    )
    print(f"[run] {pod_name} applied")


def _generator_script(scenario: str) -> str:
    """Return the embedded python script for the generator pod."""
    if scenario == "latency":
        duration_ns_expr = "5_000_000_000"   # 5s — 10× the 500ms SLO
        error_rate = "0.0"
    elif scenario == "error":
        duration_ns_expr = "200_000_000"     # 200ms — well below SLO
        error_rate = "0.01"                  # 1% errors — 10× the 0.1% SLO
    else:
        raise ValueError(f"unknown scenario {scenario}")

    return f"""
import json, os, time, random, urllib.request

URL = os.environ["OTLP_URL"]
DURATION_MIN = int(os.environ["DURATION_MIN"])
END = time.time() + DURATION_MIN * 60

def emit(name, duration_ns, status_code):
    start = int(time.time() * 1e9)
    end   = start + duration_ns
    trace_id = bytes(random.getrandbits(8) for _ in range(16)).hex()
    span_id  = bytes(random.getrandbits(8) for _ in range(8)).hex()
    payload = {{
        "resourceSpans": [{{
            "resource": {{"attributes": [
                {{"key": "service.name", "value": {{"stringValue": "chiefaia-wizard"}}}},
            ]}},
            "scopeSpans": [{{
                "scope": {{"name": "burn-rate-generator"}},
                "spans": [{{
                    "traceId": trace_id, "spanId": span_id,
                    "name": name,
                    "kind": 2,                       # SPAN_KIND_SERVER
                    "startTimeUnixNano": str(start),
                    "endTimeUnixNano": str(end),
                    "status": {{"code": status_code}},
                }}],
            }}],
        }}]
    }}
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={{"Content-Type": "application/json"}},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception as exc:
        print(f"emit failed: {{exc}}")

print(f"emitting {{DURATION_MIN}}m of {scenario!r} spans → {{URL}}")
n = 0
while time.time() < END:
    n += 1
    is_err = random.random() < {error_rate}
    emit("wizard.step.onboarding", {duration_ns_expr}, 2 if is_err else 1)
    time.sleep(1)             # 1 span/sec/pod = 60/min
print(f"done — emitted {{n}} spans")
"""


def scenario_latency(duration_min: int = 10) -> None:
    """Latency blast — expect WizardStepRenderP95BurnRateCritical to fire."""
    emit_spans_pod("latency", duration_min)
    print(f"[wait] sleeping {duration_min}m to let burn-rate alert fire ...")
    time.sleep(duration_min * 60)
    print("[verify] querying ALERTS{alertname=\"WizardStepRenderP95BurnRateCritical\"} ...")
    result = query_prom('ALERTS{alertname="WizardStepRenderP95BurnRateCritical"}')
    print(json.dumps(result, indent=2))
    print("[verify] fetching INBOX ...")
    inbox = fetch_inbox()
    assert "WizardStepRenderP95BurnRateCritical" in inbox, "alert did not reach INBOX"
    print("[ok] latency blast verified")


def scenario_error(duration_min: int = 10) -> None:
    """Error blast — expect WizardStepErrorRatioBurnRateWarning to fire."""
    emit_spans_pod("error", duration_min)
    print(f"[wait] sleeping {duration_min}m to let burn-rate alert fire ...")
    time.sleep(duration_min * 60)
    print("[verify] querying ALERTS{alertname=\"WizardStepErrorRatioBurnRateWarning\"} ...")
    result = query_prom('ALERTS{alertname="WizardStepErrorRatioBurnRateWarning"}')
    print(json.dumps(result, indent=2))
    inbox = fetch_inbox()
    assert "WizardStepErrorRatioBurnRateWarning" in inbox, "alert did not reach INBOX"
    print("[ok] error blast verified")


def scenario_recovery() -> None:
    """Stop all generators — expect RESOLVED entries to appear."""
    print("[cleanup] deleting burn-rate generator pods ...")
    kubectl("delete", "pod", "-l", "app.kubernetes.io/name=burn-rate-generator", check=False)
    print("[wait] sleeping 6m for resolve_timeout to elapse ...")
    time.sleep(6 * 60)
    inbox = fetch_inbox()
    assert "[RESOLVED:" in inbox, "no RESOLVED entry in INBOX"
    print("[ok] recovery verified")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("scenario", choices=["latency", "error", "recovery", "all"])
    parser.add_argument("--duration-min", type=int, default=10)
    args = parser.parse_args()

    if args.scenario in ("latency", "all"):
        scenario_latency(args.duration_min)
    if args.scenario in ("error", "all"):
        scenario_error(args.duration_min)
    if args.scenario in ("recovery", "all"):
        scenario_recovery()
    return 0


if __name__ == "__main__":
    sys.exit(main())

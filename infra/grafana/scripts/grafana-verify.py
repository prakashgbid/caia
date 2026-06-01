#!/usr/bin/env python3
"""Phase C2 post-deploy verification for Grafana.

Validates, against the live Grafana pod in the chiefaia namespace:

  1. /api/health responds with database: ok
  2. The Tempo datasource (uid=tempo) reports healthy
  3. ≥ 3 dashboards have been loaded (caia-traces, caia-wizard-flow,
     caia-claude-calls)

Authenticates as admin using the password from the in-cluster
Secret `chiefaia/grafana-admin`. All HTTP requests are issued from
inside the cluster (`kubectl exec` into the Grafana pod itself,
talking to localhost:3000) so credentials never leave the cluster.

Usage:
    python3 infra/grafana/scripts/grafana-verify.py
    python3 infra/grafana/scripts/grafana-verify.py --json     # machine-readable

Exits 0 on success, 1 on any check failure.
"""
from __future__ import annotations

import argparse
import base64
import json
import shlex
import subprocess
import sys

NS = "chiefaia"
DEPLOY = "deploy/grafana"
SECRET = "grafana-admin"
EXPECTED_DASHBOARD_UIDS = {"caia-traces", "caia-wizard-flow", "caia-claude-calls"}


def run(cmd: list[str], check: bool = True) -> str:
    """Run a command, return stdout. Raise on non-zero if `check`."""
    r = subprocess.run(cmd, capture_output=True, text=True)
    if check and r.returncode != 0:
        sys.stderr.write(f"command failed: {' '.join(shlex.quote(c) for c in cmd)}\n")
        sys.stderr.write(r.stderr)
        sys.exit(2)
    return r.stdout


def admin_password() -> str:
    raw = run([
        "kubectl", "-n", NS, "get", "secret", SECRET,
        "-o", "jsonpath={.data.admin-password}",
    ])
    return base64.b64decode(raw).decode()


def pod_name() -> str:
    return run([
        "kubectl", "-n", NS, "get", "pod",
        "-l", "app.kubernetes.io/name=grafana",
        "-o", "jsonpath={.items[0].metadata.name}",
    ]).strip()


def grafana_get(pod: str, password: str, path: str) -> tuple[int, str]:
    """Exec curl inside the Grafana pod against localhost:3000."""
    url = f"http://admin:{password}@localhost:3000{path}"
    cmd = [
        "kubectl", "-n", NS, "exec", pod, "--",
        "curl", "-sS", "-o", "/tmp/out", "-w", "%{http_code}", url,
    ]
    status = run(cmd, check=False).strip()
    body = run([
        "kubectl", "-n", NS, "exec", pod, "--", "cat", "/tmp/out",
    ], check=False)
    try:
        code = int(status)
    except ValueError:
        code = -1
    return code, body


def check_health(pod: str, pw: str) -> tuple[bool, dict]:
    code, body = grafana_get(pod, pw, "/api/health")
    if code != 200:
        return False, {"http_status": code, "body": body[:500]}
    try:
        j = json.loads(body)
    except Exception as e:
        return False, {"error": f"non-json body: {e}", "body": body[:500]}
    ok = j.get("database") == "ok"
    return ok, j


def check_datasource(pod: str, pw: str) -> tuple[bool, dict]:
    code, body = grafana_get(pod, pw, "/api/datasources/uid/tempo/health")
    if code != 200:
        return False, {"http_status": code, "body": body[:500]}
    try:
        j = json.loads(body)
    except Exception as e:
        return False, {"error": f"non-json body: {e}", "body": body[:500]}
    # Grafana returns {"status":"OK","message":"...","details":{}}
    ok = j.get("status") in ("OK", "ok")
    return ok, j


def check_dashboards(pod: str, pw: str) -> tuple[bool, dict]:
    code, body = grafana_get(pod, pw, "/api/search?type=dash-db")
    if code != 200:
        return False, {"http_status": code, "body": body[:500]}
    try:
        items = json.loads(body)
    except Exception as e:
        return False, {"error": f"non-json body: {e}", "body": body[:500]}
    found_uids = {it.get("uid") for it in items}
    missing = sorted(EXPECTED_DASHBOARD_UIDS - found_uids)
    return (len(missing) == 0 and len(items) >= 3), {
        "count": len(items),
        "expected_uids": sorted(EXPECTED_DASHBOARD_UIDS),
        "found_uids": sorted(uid for uid in found_uids if uid),
        "missing": missing,
        "titles": sorted(it.get("title", "") for it in items),
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true", help="Emit machine-readable JSON.")
    args = ap.parse_args()

    pw = admin_password()
    pod = pod_name()

    health_ok, health = check_health(pod, pw)
    ds_ok, ds = check_datasource(pod, pw)
    dash_ok, dash = check_dashboards(pod, pw)

    summary = {
        "pod": pod,
        "checks": {
            "health": {"ok": health_ok, "result": health},
            "tempo_datasource": {"ok": ds_ok, "result": ds},
            "dashboards": {"ok": dash_ok, "result": dash},
        },
        "all_passed": health_ok and ds_ok and dash_ok,
    }

    if args.json:
        print(json.dumps(summary, indent=2))
    else:
        print(f"pod: {pod}")
        print(f"  [{'OK' if health_ok else 'FAIL'}] /api/health  → {health}")
        print(f"  [{'OK' if ds_ok else 'FAIL'}] /api/datasources/uid/tempo/health → {ds}")
        print(f"  [{'OK' if dash_ok else 'FAIL'}] dashboards count={dash.get('count')}"
              f" found={dash.get('found_uids')} missing={dash.get('missing')}")
        if summary["all_passed"]:
            print("\nALL CHECKS PASSED")
        else:
            print("\nFAILED — see above")

    return 0 if summary["all_passed"] else 1


if __name__ == "__main__":
    sys.exit(main())

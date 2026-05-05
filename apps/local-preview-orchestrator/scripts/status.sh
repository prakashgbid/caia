#!/usr/bin/env bash
#
# Quick-glance status check for the local preview deploys.
# Hits the status dashboard's /api/status and pretty-prints it.

set -euo pipefail

URL="${LOCAL_PREVIEW_DASHBOARD_URL:-http://127.0.0.1:5170}"

if ! curl -fsS --max-time 5 "${URL}/healthz" >/dev/null; then
    echo "Status dashboard at ${URL} is NOT reachable." >&2
    echo "Is com.stolution.local-preview.status-dashboard running?" >&2
    echo "  launchctl list | grep com.stolution.local-preview" >&2
    exit 1
fi

echo "Dashboard OK at ${URL}"
echo
curl -fsS "${URL}/api/status" | python3 -m json.tool

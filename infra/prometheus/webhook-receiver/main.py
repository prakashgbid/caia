"""Alertmanager webhook → operator INBOX receiver.

POST /alerts accepts the standard Alertmanager webhook envelope
(see https://prometheus.io/docs/alerting/latest/configuration/#webhook_config),
and appends one structured entry per alert to an INBOX file mounted
at /inbox/INBOX.md.

Entries follow the operator memory-bank standard so the file can be
rsync'd to ~/Documents/projects/agent-memory/INBOX.md without
post-processing:

    ## [SEVERITY] <alertname> — <service> — <filing-date>
    Source: alertmanager (webhook)
    Severity: critical|warning
    SLO: <slo id>
    Summary: <annotations.summary>
    Description: <annotations.description>
    Runbook: <annotations.runbook>
    Starts at: <ISO 8601>
    Resolves at: <ISO 8601 or "(active)">

Deliberately minimal: stdlib only (http.server + json), no Flask,
no requirements.txt, no requirements pin. The receiver is a
side-effect: append-only file writes. State lives in the file.

GET /healthz returns 200 OK for kubelet probes.
GET /inbox returns the current INBOX (operator convenience).
"""

from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

LOG = logging.getLogger("inbox-receiver")
logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)

INBOX_PATH = Path(os.environ.get("INBOX_PATH", "/inbox/INBOX.md"))
LISTEN_PORT = int(os.environ.get("LISTEN_PORT", "8080"))


def _format_entry(alert: dict) -> str:
    """Render one Alertmanager alert into a Markdown INBOX entry."""
    labels = alert.get("labels", {}) or {}
    annotations = alert.get("annotations", {}) or {}
    status = alert.get("status", "firing")

    alertname = labels.get("alertname", "UnknownAlert")
    service = labels.get("service", "n/a")
    severity = labels.get("severity", "info")
    slo = labels.get("slo", "")

    summary = annotations.get("summary", "(no summary)")
    description = annotations.get("description", "").strip() or "(no description)"
    runbook = annotations.get("runbook", "")

    starts_at = alert.get("startsAt") or "(unknown)"
    ends_at = alert.get("endsAt")
    if status == "resolved" and ends_at and ends_at != "0001-01-01T00:00:00Z":
        resolves_at = ends_at
    else:
        resolves_at = "(active)"

    filing_date = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ")

    severity_tag = f"[{severity.upper()}]"
    if status == "resolved":
        severity_tag = f"[RESOLVED:{severity.upper()}]"

    lines = [
        f"## {severity_tag} {alertname} — {service} — {filing_date}",
        f"Source: alertmanager (webhook)",
        f"Severity: {severity}",
    ]
    if slo:
        lines.append(f"SLO: {slo}")
    lines.extend(
        [
            f"Summary: {summary}",
            f"Description:",
            f"  {description}",
        ]
    )
    if runbook:
        lines.append(f"Runbook: {runbook}")
    lines.extend(
        [
            f"Starts at: {starts_at}",
            f"Resolves at: {resolves_at}",
            "",
        ]
    )
    return "\n".join(lines)


def _append_inbox(entry: str) -> None:
    INBOX_PATH.parent.mkdir(parents=True, exist_ok=True)
    with INBOX_PATH.open("a", encoding="utf-8") as f:
        f.write(entry)
        f.write("\n")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args) -> None:  # noqa: A002
        LOG.info("%s - %s", self.address_string(), format % args)

    def _send(self, status: int, body: bytes, ctype: str = "text/plain") -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            return self._send(200, b"ok\n")
        if self.path == "/inbox":
            try:
                body = INBOX_PATH.read_bytes()
            except FileNotFoundError:
                body = b"(inbox is empty)\n"
            return self._send(200, body, "text/markdown; charset=utf-8")
        return self._send(404, b"not found\n")

    def do_POST(self) -> None:  # noqa: N802
        if self.path not in ("/alerts", "/"):
            return self._send(404, b"not found\n")
        length = int(self.headers.get("Content-Length", "0") or "0")
        try:
            raw = self.rfile.read(length) if length > 0 else b"{}"
            payload = json.loads(raw.decode("utf-8") or "{}")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            LOG.warning("bad payload: %s", exc)
            return self._send(400, b"bad payload\n")

        alerts = payload.get("alerts") or []
        if not isinstance(alerts, list):
            return self._send(400, b"alerts must be a list\n")

        written = 0
        for alert in alerts:
            try:
                entry = _format_entry(alert)
                _append_inbox(entry)
                written += 1
            except OSError as exc:
                LOG.error("inbox write failed: %s", exc)
                return self._send(500, b"inbox write failed\n")

        LOG.info("wrote %d INBOX entries (group=%s)", written, payload.get("groupKey", ""))
        return self._send(200, f"ok wrote={written}\n".encode("utf-8"))


def main() -> int:
    LOG.info("INBOX path: %s", INBOX_PATH)
    LOG.info("listening on :%d", LISTEN_PORT)
    server = ThreadingHTTPServer(("0.0.0.0", LISTEN_PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        LOG.info("shutting down")
        server.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())

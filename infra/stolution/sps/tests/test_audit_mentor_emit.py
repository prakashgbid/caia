#!/usr/bin/env python3
"""Unit tests for the mentor-event-bus emit helper added in A.10.9
(infra/stolution/sps/scripts/audit_recent_done.py).

We don't actually run the full audit pipeline here — those flows are
covered by test_b15e_audit_recent_done.sh — instead we drive the inline
`_emit_mentor_event` helper directly and assert on:

  1. No-op return when CAIA_EVENT_BUS_SECRET is unset.
  2. Successful POST with the expected HMAC signature when configured.
  3. Silent failure on server 500.
  4. Silent failure on connection refused (server down).

Run from infra/stolution/sps/tests directory:
    python3 test_audit_mentor_emit.py
Exits non-zero on any failure.
"""
from __future__ import annotations

import hashlib
import hmac
import importlib.util
import json
import os
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SCRIPT_PATH = HERE.parent / 'scripts' / 'audit_recent_done.py'


def _load_module() -> Any:
    spec = importlib.util.spec_from_file_location('audit_recent_done', SCRIPT_PATH)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _CapturingHandler(BaseHTTPRequestHandler):
    received: list[dict[str, Any]] = []
    response_status: int = 200

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get('content-length', 0) or 0)
        body = self.rfile.read(length).decode('utf-8') if length else ''
        # http.client preserves the case it was sent in; the emit helper
        # uses lowercase, but normalise here so tests don't depend on it.
        norm_headers = {k.lower(): v for k, v in self.headers.items()}
        type(self).received.append({
            'path': self.path,
            'body': body,
            'headers': norm_headers,
        })
        self.send_response(type(self).response_status)
        self.send_header('content-type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{"ingested":1,"offsets":[1]}')

    def log_message(self, *_a: Any, **_k: Any) -> None:  # noqa: D401
        """Quiet the default access-log spam."""


def _start_server(status: int = 200) -> tuple[HTTPServer, threading.Thread, int]:
    _CapturingHandler.received = []
    _CapturingHandler.response_status = status
    srv = HTTPServer(('127.0.0.1', 0), _CapturingHandler)
    port = srv.server_address[1]
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    return srv, th, port


class TestAuditMentorEmit(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.module = _load_module()  # type: ignore[attr-defined]

    def setUp(self) -> None:
        # Clean env so no test leaks credentials into the next.
        for k in ('CAIA_EVENT_BUS_SECRET',
                  'CAIA_EVENT_BUS_SECRET_PATH',
                  'CAIA_MENTOR_EVENT_BUS_URL'):
            os.environ.pop(k, None)

    def test_noop_when_secret_unset(self) -> None:
        ok = self.module._emit_mentor_event(
            'DoDViolation',
            {'taskId': 't1', 'rule': 'r', 'description': 'd'},
        )
        self.assertFalse(ok)

    def test_post_signed_event(self) -> None:
        srv, _th, port = _start_server()
        try:
            secret = 'x' * 40
            os.environ['CAIA_EVENT_BUS_SECRET'] = secret
            os.environ['CAIA_MENTOR_EVENT_BUS_URL'] = f'http://127.0.0.1:{port}'

            ok = self.module._emit_mentor_event(
                'DoDViolation',
                {
                    'taskId': 'node-42',
                    'rule': 'audit-rubric:score<=2:1',
                    'description': 'verifier verdict=fail',
                },
                correlation_id='audit-abc',
            )
            self.assertTrue(ok)
            self.assertEqual(len(_CapturingHandler.received), 1)
            req = _CapturingHandler.received[0]
            self.assertEqual(req['path'], '/v1/events')
            parsed = json.loads(req['body'])
            self.assertEqual(len(parsed['events']), 1)
            event = parsed['events'][0]
            self.assertEqual(event['event_type'], 'DoDViolation')
            self.assertEqual(event['correlation_id'], 'audit-abc')
            payload = json.loads(event['payload_json'])
            self.assertEqual(payload['taskId'], 'node-42')

            ts = req['headers']['x-caia-timestamp']
            sig = req['headers']['x-caia-signature']
            expected = hmac.new(
                secret.encode('utf-8'),
                f"{ts}:{req['body']}".encode('utf-8'),
                hashlib.sha256,
            ).hexdigest()
            self.assertEqual(sig, expected)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_silent_on_server_500(self) -> None:
        srv, _th, port = _start_server(status=500)
        try:
            os.environ['CAIA_EVENT_BUS_SECRET'] = 'x' * 40
            os.environ['CAIA_MENTOR_EVENT_BUS_URL'] = f'http://127.0.0.1:{port}'
            ok = self.module._emit_mentor_event(
                'HallucinationFlagged',
                {'description': 'x', 'source': 's'},
            )
            # Server returns 500 → emit returns False but does NOT raise.
            self.assertFalse(ok)
        finally:
            srv.shutdown()
            srv.server_close()

    def test_silent_on_connection_refused(self) -> None:
        # Bind a socket on an ephemeral port, immediately close it, then
        # point the emitter at that port to guarantee a refusal.
        s = socket.socket()
        s.bind(('127.0.0.1', 0))
        port = s.getsockname()[1]
        s.close()
        os.environ['CAIA_EVENT_BUS_SECRET'] = 'x' * 40
        os.environ['CAIA_MENTOR_EVENT_BUS_URL'] = f'http://127.0.0.1:{port}'
        ok = self.module._emit_mentor_event(
            'DoDViolation', {'taskId': 't', 'rule': 'r', 'description': 'd'},
        )
        self.assertFalse(ok)

    def test_short_secret_rejected(self) -> None:
        # Secret must be at least 32 chars (matches the TS auth.ts contract).
        os.environ['CAIA_EVENT_BUS_SECRET'] = 'short'
        ok = self.module._emit_mentor_event(
            'DoDViolation', {'taskId': 't', 'rule': 'r', 'description': 'd'},
        )
        self.assertFalse(ok)


if __name__ == '__main__':
    sys.exit(0 if unittest.main(exit=False).result.wasSuccessful() else 1)

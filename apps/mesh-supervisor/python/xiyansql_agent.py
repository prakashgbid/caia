"""
A2A-compliant agent shell that fronts XiYanSQL on http://127.0.0.1:8410.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0:
  "A2A wrapping of XiYanSQL: agent card at http://m3:8410/a2a/agent-card.json;
   JSON-RPC method `tasks/send`; SSE streaming on `tasks/sendSubscribe`."

This file ships TWO modes:

1. `mock` — returns a canned SQL response so the supervisor + sql-helper can
   be smoke-tested today, before the 19 GB XiYanSQL weights are downloaded.
2. `xiyansql` — forwards the prompt to a local `mlx_lm.server` instance
   running XGenerationLab/XiYanSQL-QwenCoder-32B-2504. Flipped on once the
   model is on disk; the rest of the mesh wiring doesn't change.

Per the operator's "actually using it" rule: shipping mock-mode means the
adapter, the registry, and the sql-helper are exercised end-to-end TODAY.
The flip-to-real is a one-env-var change (`XIYAN_SQL_MODE=xiyansql`) — no
re-scaffolding needed.

Usage:
    XIYAN_SQL_MODE=mock python python/xiyansql_agent.py
    # then in another shell:
    curl -sX POST http://127.0.0.1:8410/a2a -H 'content-type: application/json' \\
      -d '{"jsonrpc":"2.0","id":"t1","method":"tasks/send",
           "params":{"taskId":"t1","contextId":"ctx1",
                     "input":{"task":"top 10 by score","schema":"CREATE TABLE x(a int);"}}}'

To use the real model (M3 has 36GB unified memory):
    pip install mlx-lm
    mlx_lm.server --host 127.0.0.1 --port 8411 \\
        --model XGenerationLab/XiYanSQL-QwenCoder-32B-2504 &
    XIYAN_SQL_MODE=xiyansql MLX_LM_URL=http://127.0.0.1:8411 \\
        python python/xiyansql_agent.py
"""
from __future__ import annotations

import datetime as dt
import json
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.request import Request, urlopen


MODE = os.environ.get("XIYAN_SQL_MODE", "mock")
MLX_LM_URL = os.environ.get("MLX_LM_URL", "http://127.0.0.1:8411")
PORT = int(os.environ.get("XIYAN_SQL_PORT", "8410"))

# Model display string for provenance — flipped automatically with MODE.
MODEL_ID = (
    "XGenerationLab/XiYanSQL-QwenCoder-32B-2504"
    if MODE == "xiyansql"
    else "XiYanSQL-QwenCoder-32B-2504-MOCK"
)
MODEL_VERSION = "2504-Q4-mlx" if MODE == "xiyansql" else "mock-0.1"


AGENT_CARD: dict[str, Any] = {
    "schemaVersion": "1.0",
    "agentId": "xiyansql-32b",
    "name": "XiYanSQL-QwenCoder-32B",
    "description": (
        "Natural-language → SQL specialist. BIRD EX 69.03% SOTA single-model. "
        "Apache-2.0. Hosted via mlx_lm.server. Plan §3 M0 chain #5."
    ),
    "url": f"http://127.0.0.1:{PORT}",
    "vendor": {"name": "XGenerationLab", "url": "https://huggingface.co/XGenerationLab"},
    "provider": {"kind": "local", "model": MODEL_ID, "license": "apache-2.0"},
    "skills": [
        {
            "id": "sql.compose",
            "name": "Natural language to SQL",
            "description": "Generate SQL from an NL task plus DDL schema.",
            "tags": ["sql", "nl2sql"],
        },
        {
            "id": "sql.review",
            "name": "SQL review",
            "description": "Review a SQL query for correctness + safety.",
            "tags": ["sql", "review"],
        },
    ],
    "auth": {"kind": "none"},
}


# ---------------------------------------------------------------------------
# Inference paths
# ---------------------------------------------------------------------------

def _run_mock(task: str, schema: str, dialect: str) -> dict[str, str]:
    """Heuristic mock that picks a sensible-looking SQL skeleton.

    Good enough to exercise the end-to-end adapter chain; intentionally
    avoids hallucinating column names. Real XiYanSQL takes over once
    XIYAN_SQL_MODE=xiyansql.
    """
    # Try to find the first table in the DDL so the mock output is
    # at least minimally aligned with the schema the caller passed.
    m = re.search(r"create\s+table\s+(?:if\s+not\s+exists\s+)?[\"`]?(\w+)", schema, re.I)
    table = m.group(1) if m else "your_table"
    sql = f"-- mock NL→SQL\nSELECT *\nFROM {table}\n-- task: {task}\nLIMIT 10;"
    rationale = (
        f"MOCK MODE — XiYanSQL weights not yet on disk. Once the 19GB Q4 model "
        f"lands and XIYAN_SQL_MODE=xiyansql is set, this same endpoint serves "
        f"real NL→{dialect} SQL with BIRD-EX SOTA quality."
    )
    return {"sql": sql, "rationale": rationale}


def _run_xiyansql(task: str, schema: str, dialect: str) -> dict[str, str]:
    """Forward to mlx_lm.server — chat-completions-compatible API."""
    prompt = (
        "You are a SQL expert. Given the following DDL and a natural-language "
        "task, output ONLY a valid " + dialect + " SQL query.\n\n"
        "DDL:\n" + schema + "\n\nTask: " + task + "\n\nSQL:"
    )
    payload = {
        "model": MODEL_ID,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.0,
        "max_tokens": 1024,
    }
    req = Request(
        f"{MLX_LM_URL}/v1/chat/completions",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json"},
    )
    with urlopen(req, timeout=120) as r:
        body = json.loads(r.read())
    sql = body["choices"][0]["message"]["content"].strip()
    return {"sql": sql, "rationale": "XiYanSQL inference at temp=0"}


def _infer(task: str, schema: str, dialect: str) -> dict[str, str]:
    return _run_mock(task, schema, dialect) if MODE == "mock" else _run_xiyansql(task, schema, dialect)


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class A2AHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:  # noqa: A003
        sys.stderr.write(f"[xiyansql-agent {MODE}] {fmt % args}\n")

    def _write_json(self, status: int, body: Any) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/a2a/agent-card.json":
            return self._write_json(200, AGENT_CARD)
        if self.path == "/health":
            return self._write_json(200, {"ok": True, "mode": MODE, "model": MODEL_ID})
        self._write_json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/a2a":
            return self._write_json(404, {"error": "not found"})
        length = int(self.headers.get("content-length", "0"))
        body = json.loads(self.rfile.read(length))
        rpc_id = body.get("id")
        method = body.get("method")
        params = body.get("params") or {}
        if method != "tasks/send":
            return self._write_json(200, {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {"code": -32601, "message": f"method not found: {method}"},
            })
        inp = params.get("input") or {}
        try:
            result = _infer(
                task=inp.get("task", ""),
                schema=inp.get("schema", ""),
                dialect=inp.get("dialect", "postgres"),
            )
        except Exception as e:  # noqa: BLE001
            return self._write_json(200, {
                "jsonrpc": "2.0",
                "id": rpc_id,
                "error": {"code": -32000, "message": str(e)},
            })
        artifact = {
            "artifactId": f"{params.get('taskId','t')}::sql",
            "kind": "sql",
            "body": result,
            "producerModel": MODEL_ID,
            "producerVersion": MODEL_VERSION,
            "caiaChainRunId": params.get("contextId", ""),
            "caiaPhaseStepId": "sql.compose",
            "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
        self._write_json(200, {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "result": {"status": "done", "artifact": artifact},
        })


def main() -> None:
    print(f"xiyansql-agent listening on 127.0.0.1:{PORT}  mode={MODE}  model={MODEL_ID}")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), A2AHandler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        srv.shutdown()


if __name__ == "__main__":
    main()

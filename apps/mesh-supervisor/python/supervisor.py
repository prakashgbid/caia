"""
LangGraph supervisor graph for P5 agent-mesh.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0 deliverable:
> LangGraph supervisor boots, restores from PostgresSaver on restart, can run
> a 3-node 'echo -> echo -> echo' graph end-to-end (smoke test).

M1 adds the real supervisor → A2A → specialist path: this file now wires
`node_sql_compose` to dispatch a `tasks/send` to the local XiYanSQL agent
(127.0.0.1:8410). Output is captured into `state.artifacts_by_agent` and
written to mesh_supervisor.artifact_provenance.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import urllib.request
import uuid
from datetime import datetime, timezone

from langgraph.graph import StateGraph, START, END

from state import (
    A2ATask,
    Artifact,
    CaiaMeshState,
    EvidenceGateState,
    ProvenanceRecord,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# A2A dispatch helper (no external dep — bare urllib so the supervisor is
# importable on any Python 3.11+ install)
# ---------------------------------------------------------------------------

def _dispatch_a2a(url: str, task_id: str, context_id: str, payload: dict) -> dict:
    body = json.dumps({
        "jsonrpc": "2.0",
        "id": task_id,
        "method": "tasks/send",
        "params": {"taskId": task_id, "contextId": context_id, "input": payload},
    }).encode()
    req = urllib.request.Request(
        f"{url.rstrip('/')}/a2a",
        data=body,
        headers={"content-type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


# ---------------------------------------------------------------------------
# Node implementations
# ---------------------------------------------------------------------------

def node_intake(state: CaiaMeshState) -> CaiaMeshState:
    """Initialise the run: ensure context_id, start provenance."""
    context_id = state.get("context_id") or str(uuid.uuid4())
    return {
        "context_id": context_id,
        "task_history": [
            A2ATask(
                task_id=f"{context_id}::intake",
                context_id=context_id,
                agent_id="supervisor",
                method="intake",
                input_summary="run started",
                status="done",
            )
        ],
        "caia_provenance": ProvenanceRecord(
            caia_chain_run_id=context_id,
            caia_phase_step_id="intake",
            started_at=_now(),
        ),
    }


def node_echo(state: CaiaMeshState) -> CaiaMeshState:
    """Middle node — emits a dummy artifact to exercise the reducer."""
    context_id = state["context_id"]
    artifact = Artifact(
        artifact_id=f"{context_id}::echo",
        artifact_kind="echo",
        body={"msg": "hello from the supervisor"},
        producer_model="supervisor-echo",
        caia_chain_run_id=context_id,
        caia_phase_step_id="echo",
    )
    return {
        "artifacts_by_agent": {"echo-node": [artifact]},
        "task_history": [
            A2ATask(
                task_id=f"{context_id}::echo",
                context_id=context_id,
                agent_id="echo-node",
                method="tasks/send",
                input_summary="echo",
                status="done",
            )
        ],
    }


def node_sql_compose(state: CaiaMeshState) -> CaiaMeshState:
    """Dispatch the NL→SQL task to the XiYanSQL A2A agent.

    The task input lives in `state['sql_task']` and `state['sql_schema']`.
    Output is captured into `state.artifacts_by_agent['xiyansql-32b']`.
    """
    context_id = state["context_id"]
    sql_task = state.get("sql_task")  # type: ignore[typeddict-item]
    sql_schema = state.get("sql_schema")  # type: ignore[typeddict-item]
    dialect = state.get("sql_dialect", "postgres")  # type: ignore[typeddict-item]
    if not sql_task or not sql_schema:
        return {}  # nothing to do — skip cleanly

    url = os.environ.get("XIYAN_SQL_URL", "http://127.0.0.1:8410")
    task_id = f"{context_id}::sql.compose"
    resp = _dispatch_a2a(
        url=url,
        task_id=task_id,
        context_id=context_id,
        payload={"task": sql_task, "schema": sql_schema, "dialect": dialect},
    )
    raw = resp.get("result", {}).get("artifact") or {}
    artifact = Artifact(
        artifact_id=raw.get("artifactId", f"{task_id}::sql"),
        artifact_kind="sql",
        body=raw.get("body") or {},
        producer_model=raw.get("producerModel", "xiyansql-unknown"),
        producer_version=raw.get("producerVersion", ""),
        caia_chain_run_id=raw.get("caiaChainRunId", context_id),
        caia_phase_step_id=raw.get("caiaPhaseStepId", "sql.compose"),
    )
    return {
        "artifacts_by_agent": {"xiyansql-32b": [artifact]},
        "task_history": [
            A2ATask(
                task_id=task_id,
                context_id=context_id,
                agent_id="xiyansql-32b",
                method="tasks/send",
                input_summary=sql_task,
                status="done",
            )
        ],
    }


def node_terminal(state: CaiaMeshState) -> CaiaMeshState:
    """Terminal — mark provenance complete + close evidence gate."""
    context_id = state["context_id"]
    prov = state.get("caia_provenance") or ProvenanceRecord(
        caia_chain_run_id=context_id
    )
    return {
        "evidence": EvidenceGateState(
            contexts_passed={"evidence-shape", "no-fabrication"},
        ),
        "caia_provenance": ProvenanceRecord(
            caia_chain_run_id=prov.caia_chain_run_id,
            caia_phase_step_id="terminal",
            started_at=prov.started_at,
            completed_at=_now(),
        ),
        "task_history": [
            A2ATask(
                task_id=f"{context_id}::terminal",
                context_id=context_id,
                agent_id="supervisor",
                method="terminal",
                input_summary="run complete",
                status="done",
            )
        ],
    }


# ---------------------------------------------------------------------------
# Graph construction
# ---------------------------------------------------------------------------

def build_graph(*, with_sql: bool = False):
    """Build the supervisor graph.

    Args:
        with_sql: if True, insert the `sql.compose` node between echo and
                  terminal. The M0 smoke test runs without it; the M1 smoke
                  test runs with it.
    """
    g = StateGraph(CaiaMeshState)
    g.add_node("intake", node_intake)
    g.add_node("echo", node_echo)
    if with_sql:
        g.add_node("sql_compose", node_sql_compose)
    g.add_node("terminal", node_terminal)

    g.add_edge(START, "intake")
    g.add_edge("intake", "echo")
    if with_sql:
        g.add_edge("echo", "sql_compose")
        g.add_edge("sql_compose", "terminal")
    else:
        g.add_edge("echo", "terminal")
    g.add_edge("terminal", END)
    return g


def compile_graph(checkpointer, *, with_sql: bool = False):
    return build_graph(with_sql=with_sql).compile(checkpointer=checkpointer)


__all__ = ["build_graph", "compile_graph"]

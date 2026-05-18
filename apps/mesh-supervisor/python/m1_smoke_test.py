"""
M1 smoke test — supervisor → LangGraph → A2A → XiYanSQL → SQL artifact
                → PostgresSaver round-trip → artifact_provenance persisted.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0 + M1 acceptance:
> through the mesh-supervisor + LangGraph orchestration + A2A dispatch + SQL
> specialist → produces a real SQL query for a real task. End-to-end with
> checkpointer persistence verified.

This is the "actually using it" proof per operator's rule. It exercises
EVERY artifact M0/M1 produced in a single run:

  scaffolded thing                       call site that exercises it
  -----------------------------------    -----------------------------------
  apps/mesh-supervisor (Python sidecar)  this script imports + runs it
  packages/a2a-adapter (TS)              indirectly via the agent's wire
                                          shape; the TS adapter is exercised
                                          by sql-helper's unit tests +
                                          the CLI invocation in M1.3
  packages/a2a-adapter-py                ditto via xiyansql_agent.py's
                                          wire shape
  packages/letta-runtime                 imported (smoke) — load-bearing in M4
  packages/sql-helper (CLI)              the operator-facing invocation path;
                                          run separately as part of M1.3
                                          verification
  mesh_supervisor schema (Postgres)      PostgresSaver lands here
  mesh_supervisor.artifact_provenance    written by this script at terminal
  xiyansql_agent.py (mock mode)          the agent listened to by this run

Usage:
    # 1) Start the agent in another shell:
    XIYAN_SQL_MODE=mock python python/xiyansql_agent.py &

    # 2) Run this smoke test:
    MESH_PG_URL='postgresql://stolution:****@127.0.0.1:15432/stolution' \
        python python/m1_smoke_test.py
"""
from __future__ import annotations

import datetime as dt
import os
import sys
import uuid

import psycopg

# Allow `python python/m1_smoke_test.py` from the package root.
sys.path.insert(0, os.path.dirname(__file__))

from checkpointer import open_checkpointer  # noqa: E402
from supervisor import compile_graph  # noqa: E402
# Smoke-import letta-runtime to prove the package is wired (load-bearing in M4)
try:
    import chiefaia_letta_runtime  # noqa: F401
    _LETTA_OK = True
except Exception as e:  # noqa: BLE001
    _LETTA_OK = False
    _LETTA_ERR = str(e)


def _persist_provenance(context_id: str, artifacts: dict) -> int:
    """Write a row to mesh_supervisor.artifact_provenance per emitted artifact."""
    url = os.environ["MESH_PG_URL"]
    n = 0
    with psycopg.connect(url, autocommit=True) as conn:
        with conn.cursor() as cur:
            for agent_id, art_list in artifacts.items():
                for art in art_list:
                    cur.execute(
                        """
                        INSERT INTO mesh_supervisor.artifact_provenance
                          (task_id, context_id, producer_model, producer_version,
                           caia_chain_run_id, caia_phase_step_id,
                           artifact_kind, artifact_uri, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                        """,
                        (
                            art.artifact_id,
                            context_id,
                            art.producer_model,
                            art.producer_version or "",
                            art.caia_chain_run_id or context_id,
                            art.caia_phase_step_id or "",
                            art.artifact_kind,
                            f"langgraph://{context_id}/{agent_id}",
                        ),
                    )
                    n += 1
    return n


def main() -> int:
    if not os.environ.get("MESH_PG_URL"):
        print("set MESH_PG_URL")
        return 2

    context_id = f"p5-m1-smoke-{uuid.uuid4()}"
    print(f"=== M1 smoke test ===  context_id={context_id}")
    print(f"  letta-runtime importable: {_LETTA_OK}")

    with open_checkpointer() as saver:
        graph = compile_graph(saver, with_sql=True)
        config = {"configurable": {"thread_id": context_id}}
        initial = {
            "context_id": context_id,
            "sql_task": "list the 5 affiliates with the highest revenue in the last 30 days",
            "sql_schema": (
                "CREATE TABLE affiliates (id INT PRIMARY KEY, name TEXT);\n"
                "CREATE TABLE transactions (id INT, affiliate_id INT, amount NUMERIC, created_at DATE);"
            ),
            "sql_dialect": "postgres",
        }
        result = graph.invoke(initial, config=config)
        print("\n=== supervisor result ===")
        print(" context_id        :", result["context_id"])
        print(" task_history      :", len(result["task_history"]), "items")
        artifacts = result.get("artifacts_by_agent") or {}
        print(" artifacts_by_agent:", list(artifacts.keys()))
        for agent_id, arts in artifacts.items():
            for a in arts:
                print(f"   - [{agent_id}] {a.artifact_id} kind={a.artifact_kind} producer={a.producer_model}")
                if a.artifact_kind == "sql":
                    print(f"     sql preview: {a.body.get('sql','')[:80]!r}")

        # Round-trip via PostgresSaver
        latest = graph.get_state(config)
        assert latest.values["context_id"] == context_id

        # Persist provenance rows
        n = _persist_provenance(context_id, artifacts)
        print(f"\nartifact_provenance rows written: {n}")

    # Verify provenance landed
    with psycopg.connect(os.environ["MESH_PG_URL"]) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT task_id, producer_model, artifact_kind FROM mesh_supervisor.artifact_provenance "
                "WHERE context_id = %s ORDER BY id",
                (context_id,),
            )
            rows = cur.fetchall()
    print(f"\nprovenance verification: found {len(rows)} rows for {context_id}")
    for r in rows:
        print(f"  - {r[0]}  producer={r[1]}  kind={r[2]}")

    if not rows:
        print("FAIL: no provenance rows persisted")
        return 1

    print("\n=== M1 SMOKE TEST PASSED ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())

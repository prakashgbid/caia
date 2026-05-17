"""
PostgresSaver bootstrap for the mesh-supervisor.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §4.3:

> Checkpointer: PostgresSaver against schema 'mesh_supervisor' in the CAIA
> Postgres. Snapshot every super-step. Retention: 14 days for full snapshots;
> 90 days for terminal-only snapshots.
>
> Thread keying: thread_id = caia_chain_run_id so a CAIA chain run maps 1:1
> to a LangGraph thread; task_id = thread_id || phase_step_id so A2A tasks
> under that thread share a contextId == thread_id.

Env vars consumed (caller's responsibility to set them):
    MESH_PG_URL    e.g. postgresql://stolution:****@127.0.0.1:15432/stolution
                   (the local-dev SSH tunnel default; prod uses the in-box
                   localhost connection)
    MESH_PG_SCHEMA defaults to 'mesh_supervisor'
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator

from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection
from psycopg.rows import dict_row


def _conn_url() -> str:
    url = os.environ.get("MESH_PG_URL")
    if not url:
        raise RuntimeError(
            "MESH_PG_URL not set. Example for dev (SSH tunnel): "
            "MESH_PG_URL=postgresql://stolution:****@127.0.0.1:15432/stolution"
        )
    return url


def _schema() -> str:
    return os.environ.get("MESH_PG_SCHEMA", "mesh_supervisor")


@contextmanager
def open_checkpointer() -> Iterator[PostgresSaver]:
    """Yield a PostgresSaver bound to the mesh_supervisor schema."""
    url = _conn_url()
    schema = _schema()
    # psycopg connection with the search_path scoped to our schema so the
    # checkpoint tables (langgraph_checkpoints + co) live there.
    with Connection.connect(
        url,
        autocommit=True,
        prepare_threshold=0,
        row_factory=dict_row,
        options=f"-c search_path={schema},public",
    ) as conn:
        saver = PostgresSaver(conn)
        # Idempotent: creates checkpoint tables in the connection's
        # active schema (mesh_supervisor) on first call.
        saver.setup()
        yield saver


def setup_only() -> None:
    """One-shot table-creation; useful as a CLI/CI step before first run."""
    with open_checkpointer() as _:
        pass


if __name__ == "__main__":
    setup_only()
    print("PostgresSaver tables ensured in schema =", _schema())

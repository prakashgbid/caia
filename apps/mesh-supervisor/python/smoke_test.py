"""
Smoke test for the P5 mesh-supervisor.

Runs the 3-node echo graph end-to-end against the PostgresSaver, then
re-loads the thread from the checkpointer to prove round-trip persistence.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0 acceptance:
> smoke test green, PostgresSaver round-trips, schema is isolated from CAIA's
> existing tables.

Usage:
    MESH_PG_URL=postgresql://stolution:****@127.0.0.1:15432/stolution \
        ./.venv/bin/python python/smoke_test.py
"""
from __future__ import annotations

import os
import sys
import uuid

# Allow `python python/smoke_test.py` from the package root by extending
# sys.path so `state`, `checkpointer`, `supervisor` resolve.
sys.path.insert(0, os.path.dirname(__file__))

from checkpointer import open_checkpointer  # noqa: E402
from supervisor import compile_graph  # noqa: E402


def main() -> int:
    context_id = f"smoke-{uuid.uuid4()}"
    with open_checkpointer() as saver:
        graph = compile_graph(saver)
        config = {"configurable": {"thread_id": context_id}}
        # Initial run
        result = graph.invoke({"context_id": context_id}, config=config)
        print("=== run result ===")
        print(" context_id        :", result.get("context_id"))
        print(" task_history len  :", len(result.get("task_history") or []))
        print(" artifacts_by_agent:", list((result.get("artifacts_by_agent") or {}).keys()))
        print(" evidence passed   :", (result.get("evidence") or None).contexts_passed if result.get("evidence") else None)
        prov = result.get("caia_provenance")
        print(" provenance        :", prov.caia_chain_run_id, prov.caia_phase_step_id, "completed_at=" + str(prov.completed_at))

        # Re-load the thread (proves PostgresSaver round-trip)
        history = list(graph.get_state_history(config))
        print("\n=== state history (PostgresSaver round-trip) ===")
        print(" snapshots:", len(history))
        if not history:
            print("FAIL: no snapshots persisted")
            return 1
        for i, snap in enumerate(history[:5]):
            nxt = snap.next or ()
            print(f"  [{i}] step={getattr(snap.metadata,'step',getattr(snap,'metadata',{}))!r} next={nxt}")

        # Replay from the latest snapshot to prove deserialise works
        latest = graph.get_state(config)
        assert latest.values.get("context_id") == context_id, "thread mismatch"
        print("\nlatest snapshot context_id matches:", latest.values["context_id"])

    print("\nSMOKE TEST PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())

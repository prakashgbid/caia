"""
chiefaia_letta_runtime — Letta bootstrap for the P5 mesh.

Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0:
  "New package `@chiefaia/letta-runtime` bootstrap (Letta REST API + local
   SQLite backing initially; postgres backing in M4)."

Per §4.2:
  "Letta — pip install letta==0.5.* (current Apache-2.0 release)."

Deviation: 0.5.x is retired upstream; we use letta>=0.6,<0.7. Documented in
p5_m0_m1_execution_2026_05_17.md.

In M0 this package is *scaffolded but not load-bearing*. The Mentor-injection
shared-memory-block primitive comes online in M4. We expose:

- `MemoryBlock` — placeholder type for the M4 shared-block API
- `bootstrap_local()` — starts a Letta server with SQLite backing for dev

so the mesh-supervisor can import from this package today and incremental work
just lands inside this module without redesign.
"""
from .bootstrap import bootstrap_local, get_letta_url, MemoryBlock

__all__ = ["bootstrap_local", "get_letta_url", "MemoryBlock"]

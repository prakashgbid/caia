"""
chiefaia_a2a_adapter — Python façade for A2A on the mesh-supervisor side.

Used by `apps/mesh-supervisor/python/supervisor.py` to dispatch
`tasks/send` calls from LangGraph nodes into specialist agent endpoints.

Mirrors the TypeScript surface in `packages/a2a-adapter/` so the dispatch
contract is identical across the supervisor's TS Hono front and Python
LangGraph sidecar.
"""
from .client import A2AClient
from .types import A2AArtifact, A2ATaskRequest, A2ATaskResponse

__all__ = ["A2AClient", "A2AArtifact", "A2ATaskRequest", "A2ATaskResponse"]

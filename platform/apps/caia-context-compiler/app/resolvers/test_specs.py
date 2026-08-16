"""Test specifications for the factory/workflow."""
from __future__ import annotations

from ..config import settings
from ..models import ContextSection, ContextType, CompileRequest
from ._common import http_get, section, timed


async def resolve(req: CompileRequest) -> ContextSection:
    async with timed() as t:
        data = await http_get(
            f"{settings.evidence_store_url}/artifacts",
            params={
                "type": "TestSpec",
                "workflow_id": req.workflow_id,
                "limit": req.max_items_per_type,
            },
        )
        items = data.get("items", []) if isinstance(data, dict) else data or []
    return section(
        ContextType.TEST_SPECS, items, "evidence-store", "TestSpec", t["ms"]
    )
